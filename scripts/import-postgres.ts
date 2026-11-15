import { config } from "dotenv";
import { Client } from "pg";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { decodeBackup } from "../src/lib/erp/backup-format";
import { restoreTables } from "../src/lib/erp/restore";
import { postgresOptions } from "../src/lib/db/postgres-options";
config({ path: ".env.local", quiet: true }); config({ quiet: true });
async function main() {
  const [file, storageDirectory] = process.argv.slice(2);
  if (!file || !storageDirectory || !process.env.TARGET_DATABASE_URL) throw new Error("Defina TARGET_DATABASE_URL e use: npm run database:import -- arquivo.detali diretorio-de-fotos-novo");
  const payload = decodeBackup(await readFile(file, "utf8"));
  const storageRoot = path.resolve(storageDirectory);
  const destinations = payload.files.map(entry => {
    const filename = path.resolve(storageRoot, entry.key);
    if (!filename.startsWith(storageRoot + path.sep) || !entry.key.replaceAll("\\", "/").startsWith(payload.companyId + "/")) throw new Error("Caminho de anexo inválido");
    return { filename, entry };
  });
  for (const { filename } of destinations) {
    try { await access(filename); throw new Error("Há fotos existentes no destino. Use um diretório novo."); }
    catch (e) { if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) throw e; }
  }
  const client = new Client(postgresOptions(process.env.TARGET_DATABASE_URL)); await client.connect();
  try {
    const exists = await client.query("select to_regclass('public.companies') as companies, to_regclass('public.users') as users");
    for (const table of ["companies", "users"]) if (exists.rows[0][table]) {
      const result = await client.query(`select count(*)::int as n from "${table}"`);
      if (result.rows[0].n) throw new Error("O banco de destino já tem dados. Importação recusada sem sobrescrever registros.");
    }
    await client.query("create table if not exists drizzle_migrations (filename text primary key, applied_at timestamptz not null default now())");
    const applied = await client.query("select filename from drizzle_migrations"); const known = new Set(applied.rows.map(r => r.filename));
    for (const name of readdirSync("drizzle").filter(f => /^\d+_.*\.sql$/.test(f)).sort()) {
      if (known.has(name)) continue;
      await client.query("BEGIN");
      try {
        for (const statement of readFileSync(path.join("drizzle", name), "utf8").split("--> statement-breakpoint").filter(s => s.trim())) await client.query(statement);
        await client.query("insert into drizzle_migrations(filename) values ($1)", [name]); await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
    }
    const result = await restoreTables(payload, (sql, params) => client.query(sql, params));
    // Arquivos nunca sobrescrevem fotos existentes. Guarde o backup até conferir toda a importação.
    for (const { filename, entry } of destinations) { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, Buffer.from(entry.base64, "base64"), { flag: "wx" }); }
    console.log("Importação concluída no PostgreSQL de destino:", { ...result, photos: payload.files.length });
    console.log("Confira os dados antes de alterar DATABASE_URL. O banco local de origem não foi modificado.");
  } finally { await client.end(); }
}
main().catch(() => { console.error("A importação não concluiu. Verifique conexão, TLS, chave de criptografia, banco vazio e permissões. A URL e as credenciais não são exibidas."); process.exitCode = 1; });
