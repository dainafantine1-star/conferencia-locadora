import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";

async function main() {
  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  fs.mkdirSync(dataDir, { recursive: true });

  const pglite = new PGlite(dataDir);

  const drizzleDir = path.join(process.cwd(), "drizzle");
  const files = fs.existsSync(drizzleDir)
    ? fs
        .readdirSync(drizzleDir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];

  if (files.length === 0) {
    console.log("Nenhuma migracao em ./drizzle. Rode `npm run db:generate` primeiro.");
    await pglite.close();
    return;
  }

  await pglite.exec(`
    CREATE TABLE IF NOT EXISTS drizzle_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const appliedResult = await pglite.query<{ filename: string }>(
    "SELECT filename FROM drizzle_migrations",
  );
  const appliedSet = new Set((appliedResult.rows ?? []).map((r) => r.filename));

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`= ${file} (ja aplicada)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(drizzleDir, file), "utf8");
    console.log(`> aplicando ${file}`);
    await pglite.exec("BEGIN");
    try {
      await pglite.exec(sql);
      await pglite.exec(
        `INSERT INTO drizzle_migrations (filename) VALUES ('${file.replace(/'/g, "''")}')`,
      );
      await pglite.exec("COMMIT");
    } catch (e) {
      await pglite.exec("ROLLBACK");
      throw e;
    }
  }

  console.log("Migracoes concluidas.");
  await pglite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
