import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

export type Db = ReturnType<typeof createDb>;

const globalForDb = globalThis as unknown as {
  __db?: unknown;
  __pgPool?: Pool;
  __pglite?: PGlite;
};

function createDb() {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    // Produção / Vercel (ex.: Neon) — Postgres real
    const pool =
      globalForDb.__pgPool ??
      new Pool({ connectionString, max: 10 });
    // Compartilha o pool também em produção para evitar um pool por chunk/rota.
    globalForDb.__pgPool = pool;
    return drizzlePg(pool, { schema });
  }

  // Desenvolvimento local embutida — sem Docker
  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  fs.mkdirSync(dataDir, { recursive: true });
  const pglite = globalForDb.__pglite ?? new PGlite(dataDir);
  globalForDb.__pglite = pglite;
  return drizzlePglite(pglite, { schema });
}

export const db = createDb();

export function isEmbedded(): boolean {
  return !process.env.DATABASE_URL;
}
