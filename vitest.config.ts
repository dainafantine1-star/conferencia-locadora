import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // Test suites use isolated PGlite databases and temporary local files.
    // Never inherit the developer's live Supabase connection or storage keys.
    env: {
      DATABASE_URL: "",
      STORAGE_PROVIDER: "local",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      CRON_SECRET: "",
    },
    include: ["tests/**/*.test.ts"],
    maxWorkers: 1,
    testTimeout: 60000,
    hookTimeout: 120000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
