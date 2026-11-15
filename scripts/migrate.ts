import { config } from "dotenv";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";
import { postgresOptions } from "../src/lib/db/postgres-options";
config({ path: ".env.local", quiet: true }); config({ quiet: true });
async function main() {
  const directory = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  const client = process.env.DATABASE_URL ? new Client(postgresOptions(process.env.DATABASE_URL)) : new PGlite(directory);
  if (client instanceof Client) await client.connect();
  const query = (source: string, values?: unknown[]) => client instanceof Client ? client.query(source, values) : client.query<Record<string, unknown>>(source, values);
  try {
    await query("create table if not exists drizzle_migrations (filename text primary key, applied_at timestamptz not null default now())");
    const applied = await query("select filename from drizzle_migrations");
    const known = new Set(applied.rows.map(r => String(r.filename)));
    for (const file of fs.readdirSync("drizzle").filter(f => /^\d+_.*\.sql$/.test(f)).sort()) {
      if (known.has(file)) { console.log("=", file); continue; }
      await query("BEGIN");
      try {
        const source = fs.readFileSync(path.join("drizzle", file), "utf8");
        for (const statement of source.split("--> statement-breakpoint").filter(s => s.trim())) await query(statement);
        await query("insert into drizzle_migrations (filename) values ($1)", [file]);
        await query("COMMIT"); console.log("Aplicada:", file);
      } catch (error) { await query("ROLLBACK"); throw error; }
    }
    console.log("Migrações concluídas.");
  } finally { if (client instanceof Client) await client.end(); else await client.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });
