import { config } from "dotenv";
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { capturePlatform, platformImportSql, platformVerificationSql } from "../src/lib/db/platform-transfer";
import { encrypt } from "../src/lib/erp/crypto";

config({ path: ".env.local", quiet: true });
async function main() {
  const root = path.resolve(".data");
  const directory = path.resolve(process.argv[2] ?? "");
  if (!directory.startsWith(root + path.sep) || directory === path.resolve(process.env.PGLITE_DIR ?? ".data/pglite")) throw new Error("Informe uma pasta de cópia dentro de .data, diferente do banco em uso");
  if (!fs.existsSync(path.join(directory, "source", "PG_VERSION"))) throw new Error("Cópia física do banco não encontrada");
  const files = fs.readdirSync("drizzle").filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  const db = new PGlite(path.join(directory, "source"));
  try {
    const applied = (await db.query<{ filename: string }>("SELECT filename FROM drizzle_migrations ORDER BY filename")).rows.map(r => r.filename);
    if (JSON.stringify(applied) !== JSON.stringify(files)) throw new Error("Banco local e migrations diferem");
    const snapshot = await capturePlatform((sql, params) => db.query(sql, params));
    const migrations = files.map(file => ({ file, sha256: createHash("sha256").update(fs.readFileSync(path.join("drizzle", file))).digest("hex") }));
    const archive = { ...snapshot, migrations };
    fs.writeFileSync(path.join(directory, "platform.detali"), encrypt(gzipSync(Buffer.from(JSON.stringify(archive))).toString("base64")), { mode: 0o600, flag: "wx" });
    fs.writeFileSync(path.join(directory, "import.sql"), platformImportSql(snapshot), { mode: 0o600, flag: "wx" });
    fs.writeFileSync(path.join(directory, "verify.sql"), platformVerificationSql(snapshot), { mode: 0o600, flag: "wx" });
    const report = { format: snapshot.format, createdAt: snapshot.createdAt, migrations, tables: snapshot.tables.map(t => ({ name: t.name, rows: t.documents.length, checksum: t.checksum })), totalRows: snapshot.tables.reduce((n, t) => n + t.documents.length, 0) };
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify(report));
  } finally { await db.close(); }
}
main().catch(() => { console.error("Exportação cancelada; confira a cópia, o esquema e a configuração privada. Nenhum dado remoto foi alterado."); process.exitCode = 1; });
