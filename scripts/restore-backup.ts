import { config } from "dotenv";
import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

config({ path: ".env.local", quiet: true }); config({ quiet: true });
async function main() {
  const [file, target] = process.argv.slice(2);
  if (!file || !target) throw new Error("Uso: npm run backup:restore -- arquivo.detali diretorio-novo");
  const absolute = path.resolve(target);
  if (existsSync(absolute) && readdirSync(absolute).length) throw new Error("O diretório de destino deve estar vazio");
  // Import the decoder with the normal runtime configured, without touching its DB.
  const { decodeBackup } = await import("../src/lib/erp/backup-format");
  const { restoreTables } = await import("../src/lib/erp/restore");
  const payload = decodeBackup(await readFile(file, "utf8"));
  const storageRoot = path.join(absolute, "uploads");
  for (const entry of payload.files) {
    const destination = path.resolve(storageRoot, entry.key);
    if (!destination.startsWith(storageRoot + path.sep) || !entry.key.replaceAll("\\", "/").startsWith(payload.companyId + "/")) throw new Error("Caminho de anexo inválido");
  }
  await mkdir(path.join(absolute, "database"), { recursive: true });
  const client = new PGlite(path.join(absolute, "database"));
  try {
    await client.exec("create table drizzle_migrations (filename text primary key, applied_at timestamptz not null default now())");
    for (const name of readdirSync("drizzle").filter(f => f.endsWith(".sql")).sort()) {
      await client.exec(readFileSync(path.join("drizzle", name), "utf8"));
      await client.query("insert into drizzle_migrations (filename) values ($1)", [name]);
    }
    const result = await restoreTables(payload, async (sql, params) => client.query(sql, params));
    for (const entry of payload.files) {
      const destination = path.resolve(storageRoot, entry.key); await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, Buffer.from(entry.base64, "base64"), { flag: "wx" });
    }
    console.log("Restauração concluída e banco original preservado:", { ...result, files: payload.files.length, target: absolute });
    console.log("Para inspecionar, use PGLITE_DIR=" + path.join(absolute, "database") + " e STORAGE_DIR=" + storageRoot);
  } finally { await client.close(); }
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
