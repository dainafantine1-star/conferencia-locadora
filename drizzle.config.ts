import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

// Migrações geradas em ./drizzle (SQL versionado).
// Em desenvolvimento local (sem DATABASE_URL) o schema é aplicado via `npm run db:push`
// usando PGlite; em produção use `DATABASE_URL` e `drizzle-kit push` ou as migrações SQL.
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://local@localhost:5432/local",
  },
  strict: true,
  verbose: true,
});
