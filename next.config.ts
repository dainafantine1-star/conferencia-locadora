import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (WASM) não deve passar pelo bundler do Next
  serverExternalPackages: ["@electric-sql/pglite", "drizzle-orm"],
};

export default nextConfig;
