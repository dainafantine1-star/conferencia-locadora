import { createHash, randomBytes } from "node:crypto";
import { restoreOrder } from "../erp/restore";

export const platformTables = [...new Set([...restoreOrder, "saas_plans", "platform_admins", "platform_audit", "request_limits", "backup_runs"])].sort();
type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
type Column = { name: string; nullable: boolean };
type ForeignKey = { child: string; columns: string[]; parent: string };
export type PlatformSnapshot = {
  format: "detali-platform-v1";
  createdAt: string;
  tables: { name: string; columns: Column[]; primaryKey: string[]; documents: string[]; checksum: string }[];
  foreignKeys: ForeignKey[];
};
const quote = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Identificador SQL inválido");
  return `"${name}"`;
};
const literal = (value: string) => {
  let delimiter: string;
  do { delimiter = `$detali_${randomBytes(8).toString("hex")}$`; } while (value.includes(delimiter));
  return delimiter + value + delimiter;
};
export const tableDigest = (name: string) => `SELECT count(*)::int AS rows, md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text COLLATE "C"), '')) AS checksum FROM public.${quote(name)} t`;

/** Capture PostgreSQL JSON text without converting timestamps, numeric values or JSON through JS. */
export async function capturePlatform(query: Query, names = platformTables): Promise<PlatformSnapshot> {
  if (!names.length || new Set(names).size !== names.length || names.some(n => !platformTables.includes(n))) throw new Error("Tabelas inválidas");
  const result: PlatformSnapshot = { format: "detali-platform-v1", createdAt: new Date().toISOString(), tables: [], foreignKeys: [] };
  await query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await query("SET LOCAL timezone = 'UTC'");
    await query("SET LOCAL datestyle = 'ISO, YMD'");
    for (const name of names) {
      const columns = await query("SELECT column_name, is_nullable, is_generated, is_identity FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", [name]);
      if (!columns.rows.length || columns.rows.some(c => c.is_generated !== "NEVER" || c.is_identity !== "NO")) throw new Error(`Esquema não suportado: ${name}`);
      const pk = await query("SELECT a.attname FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(num, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num WHERE c.contype = 'p' AND c.conrelid = $1::regclass ORDER BY k.ord", [`public.${name}`]);
      if (!pk.rows.length) throw new Error(`Chave primária ausente: ${name}`);
      const rows = await query(`SELECT to_jsonb(t)::text AS document FROM public.${quote(name)} t ORDER BY to_jsonb(t)::text COLLATE "C"`);
      const documents = rows.rows.map(r => String(r.document));
      const digest = (await query(tableDigest(name))).rows[0];
      const checksum = createHash("md5").update(documents.join("\n")).digest("hex");
      if (checksum !== digest.checksum || Number(digest.rows) !== documents.length) throw new Error(`Snapshot inconsistente: ${name}`);
      result.tables.push({ name, columns: columns.rows.map(c => ({ name: String(c.column_name), nullable: c.is_nullable === "YES" })), primaryKey: pk.rows.map(r => String(r.attname)), documents, checksum });
    }
    const foreign = await query("SELECT t.relname AS child, p.relname AS parent, array_agg(a.attname::text ORDER BY k.ord) AS columns FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace JOIN pg_class p ON p.oid = c.confrelid CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(num, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num WHERE c.contype = 'f' AND n.nspname = 'public' GROUP BY c.oid, t.relname, p.relname ORDER BY t.relname, c.oid");
    for (const fk of foreign.rows) {
      if (!names.includes(String(fk.child))) continue;
      if (!names.includes(String(fk.parent))) throw new Error(`Tabela referenciada fora da cópia: ${fk.parent}`);
      result.foreignKeys.push({ child: String(fk.child), parent: String(fk.parent), columns: fk.columns as string[] });
    }
    await query("COMMIT");
    return result;
  } catch (error) { await query("ROLLBACK"); throw error; }
}

/** Single atomic import. Foreign keys and tenant triggers remain enabled throughout. */
export function platformImportSql(snapshot: PlatformSnapshot) {
  if (snapshot.format !== "detali-platform-v1" || !snapshot.tables.length) throw new Error("Snapshot inválido");
  const tables = new Map(snapshot.tables.map(t => [t.name, t]));
  if (tables.size !== snapshot.tables.length || [...tables.keys()].some(n => !platformTables.includes(n))) throw new Error("Tabelas inválidas");
  const delayed = new Map([...tables.keys()].map(n => [n, new Set<string>()]));
  const required = new Map([...tables.keys()].map(n => [n, new Set<string>()]));
  for (const fk of snapshot.foreignKeys) {
    const child = tables.get(fk.child);
    if (!child || !tables.has(fk.parent) || fk.columns.some(n => !child.columns.some(c => c.name === n))) throw new Error("Referência inválida");
    const nullable = fk.columns.filter(n => child.columns.find(c => c.name === n)!.nullable);
    if (nullable.length) nullable.forEach(n => delayed.get(fk.child)!.add(n));
    else required.get(fk.child)!.add(fk.parent);
  }
  const order: string[] = [];
  while (order.length < tables.size) {
    const ready = [...tables.keys()].filter(n => !order.includes(n) && [...required.get(n)!].every(p => order.includes(p)));
    if (!ready.length) throw new Error("Ciclo de referências obrigatórias: importação cancelada");
    order.push(...ready);
  }
  const sql = ["BEGIN", "SET LOCAL timezone = 'UTC'", "SET LOCAL datestyle = 'ISO, YMD'", "SET LOCAL lock_timeout = '5s'", "SET LOCAL statement_timeout = '120s'", `LOCK TABLE ${[...tables.keys()].sort().map(n => `public.${quote(n)}`).join(", ")} IN SHARE ROW EXCLUSIVE MODE`];
  const updates: string[] = [];
  for (const name of order) {
    const t = tables.get(name)!;
    if (!t.primaryKey.length || t.primaryKey.some(k => !t.columns.some(c => c.name === k))) throw new Error(`Chave primária inválida: ${name}`);
    const names = t.columns.map(c => c.name);
    if (new Set(names).size !== names.length || createHash("md5").update(t.documents.join("\n")).digest("hex") !== t.checksum) throw new Error(`Snapshot alterado: ${name}`);
    const expectedColumns = literal(JSON.stringify(names));
    sql.push(`DO $guard$ BEGIN IF (SELECT jsonb_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${name}') IS DISTINCT FROM ${expectedColumns}::jsonb THEN RAISE EXCEPTION 'Esquema incompatível: ${name}'; END IF; END $guard$`);
    const target = `public.${quote(name)}`;
    if (name === "saas_plans") {
      const ids = t.documents.map(d => JSON.parse(d).id);
      sql.push(`DO $guard$ BEGIN IF EXISTS (SELECT 1 FROM ${target} WHERE NOT (to_jsonb(id) <@ ${literal(JSON.stringify(ids))}::jsonb)) THEN RAISE EXCEPTION 'Planos inesperados no destino'; END IF; END $guard$`);
    } else sql.push(`DO $guard$ BEGIN IF EXISTS (SELECT 1 FROM ${target}) THEN RAISE EXCEPTION 'Destino já contém dados: ${name}'; END IF; END $guard$`);
    for (let offset = 0; offset < t.documents.length; offset += 100) {
      const raw = t.documents.slice(offset, offset + 100);
      for (const document of raw) {
        const row = JSON.parse(document);
        if (!row || Array.isArray(row) || Object.keys(row).length !== names.length || names.some(n => !(n in row))) throw new Error(`Registro inválido: ${name}`);
      }
      const source = `jsonb_populate_recordset(NULL::${target}, ${literal(`[${raw.join(",")}]`)}::jsonb) src`;
      const upsert = name === "saas_plans" ? ` ON CONFLICT (${t.primaryKey.map(quote).join(",")}) DO UPDATE SET ${names.filter(n => !t.primaryKey.includes(n)).map(n => `${quote(n)} = excluded.${quote(n)}`).join(",")}` : "";
      sql.push(`INSERT INTO ${target} (${names.map(quote).join(",")}) SELECT ${names.map(n => delayed.get(name)!.has(n) ? "NULL" : `src.${quote(n)}`).join(",")} FROM ${source}${upsert}`);
      if (delayed.get(name)!.size) updates.push(`UPDATE ${target} dst SET ${[...delayed.get(name)!].map(n => `${quote(n)} = src.${quote(n)}`).join(",")} FROM ${source} WHERE ${t.primaryKey.map(n => `dst.${quote(n)} = src.${quote(n)}`).join(" AND ")}`);
    }
  }
  sql.push(...updates);
  for (const t of snapshot.tables) sql.push(`DO $verify$ DECLARE actual record; BEGIN ${tableDigest(t.name)} INTO actual; IF actual.rows <> ${t.documents.length} OR actual.checksum <> '${t.checksum}' THEN RAISE EXCEPTION 'Verificação de integridade falhou: ${t.name}'; END IF; END $verify$`);
  sql.push("COMMIT");
  return sql.join(";\n") + ";";
}

export function platformVerificationSql(snapshot: PlatformSnapshot) {
  return "SET timezone = 'UTC'; SET datestyle = 'ISO, YMD';\n" + snapshot.tables.map(t => `SELECT '${t.name}' AS table_name, d.*, ${t.documents.length} AS expected_rows, '${t.checksum}' AS expected_checksum FROM (${tableDigest(t.name)}) d`).join("\nUNION ALL\n") + ";";
}
