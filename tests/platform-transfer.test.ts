import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { capturePlatform, platformImportSql, platformVerificationSql, type PlatformSnapshot } from "../src/lib/db/platform-transfer";

let source: PGlite;
let destination: PGlite;
let snapshot: PlatformSnapshot;
beforeAll(async () => {
  source = new PGlite(); destination = new PGlite();
  const schema = readdirSync("drizzle").filter(f => /^\d+_.*\.sql$/.test(f)).sort().map(f => readFileSync(`drizzle/${f}`, "utf8")).join("\n");
  for (const db of [source, destination]) {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE drizzle_migrations(filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    await db.exec(schema);
  }
  await source.exec(`
    INSERT INTO companies (id, name) VALUES ('10000000-0000-4000-8000-000000000001','Empresa A'), ('10000000-0000-4000-8000-000000000002','Empresa B');
    INSERT INTO users (id, name, email, password_hash) VALUES ('20000000-0000-4000-8000-000000000001','Administradora','migration@example.test','test-only-hash');
    INSERT INTO platform_admins (user_id) VALUES ('20000000-0000-4000-8000-000000000001');
    UPDATE saas_plans SET monthly_cents = 12345, features = '{"precise": 12345678901234567890.123456789, "text": "O''Brien $guard$"}'::jsonb WHERE id = 'essencial';
  `);
  snapshot = await capturePlatform((sql, params) => source.query(sql, params));
}, 120000);
afterAll(async () => { await source?.close(); await destination?.close(); });

describe("transferência integral para PostgreSQL", () => {
  it("mantém os helpers privados, as políticas dependentes e o bloqueio anônimo", async () => {
    const { rows } = await destination.query("SELECT to_regprocedure('public.detali_has_company(uuid)') IS NULL AS private, has_function_privilege('anon', 'detali_private.detali_has_company(uuid)', 'EXECUTE') AS anonymous, has_function_privilege('authenticated', 'detali_private.detali_has_company(uuid)', 'EXECUTE') AS authenticated, (SELECT qual LIKE '%detali_private.detali_has_company%' FROM pg_policies WHERE schemaname='public' AND tablename='customers') AS policy_updated");
    expect(rows[0]).toEqual({ private: true, anonymous: false, authenticated: true, policy_updated: true });
  });
  it("preserva todas as tabelas, duas empresas, administrador, planos alterados e precisão JSON", async () => {
    await destination.exec(platformImportSql(snapshot));
    const results = await destination.exec(platformVerificationSql(snapshot));
    const verified = results.at(-1)!.rows as Record<string, unknown>[];
    expect(verified).toHaveLength(54);
    expect(verified.every(r => r.rows === r.expected_rows && r.checksum === r.expected_checksum)).toBe(true);
    expect((await destination.query("SELECT monthly_cents FROM saas_plans WHERE id = 'essencial'")).rows[0]).toEqual({ monthly_cents: 12345 });
    expect((await destination.query("SELECT count(*)::int AS n FROM platform_admins")).rows[0]).toEqual({ n: 1 });
  });
  it("recusa destino preenchido e reverte as alterações da tentativa", async () => {
    await expect(destination.exec(platformImportSql(snapshot))).rejects.toThrow(/Destino já contém dados/);
    await destination.exec("ROLLBACK");
    const results = await destination.exec(platformVerificationSql(snapshot));
    expect((results.at(-1)!.rows as Record<string, unknown>[]).every(r => r.checksum === r.expected_checksum)).toBe(true);
  });
  it("recusa um snapshot adulterado antes de enviar dados", () => {
    const changed = structuredClone(snapshot);
    changed.tables.find(t => t.name === "companies")!.documents[0] = "{}";
    expect(() => platformImportSql(changed)).toThrow(/Snapshot alterado/);
  });
  it("resolve ciclo entre pedido e fechamento sem desativar chaves estrangeiras", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE TABLE orders(id integer PRIMARY KEY, active_closure_id integer, exact_time timestamptz NOT NULL); CREATE TABLE closures(id integer PRIMARY KEY, order_id integer NOT NULL REFERENCES orders(id)); ALTER TABLE orders ADD FOREIGN KEY(active_closure_id) REFERENCES closures(id); INSERT INTO orders VALUES(1, NULL, '2026-11-15T12:34:56.123456Z'); INSERT INTO closures VALUES(2, 1); UPDATE orders SET active_closure_id=2");
      const cycle = await capturePlatform((sql, params) => db.query(sql, params), ["orders", "closures"]);
      await db.exec("TRUNCATE orders, closures");
      await db.exec(platformImportSql(cycle));
      expect((await db.query("SELECT active_closure_id, to_char(exact_time AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS exact FROM orders")).rows[0]).toEqual({ active_closure_id: 2, exact: "2026-11-15 12:34:56.123456" });
    } finally { await db.close(); }
  });
});
