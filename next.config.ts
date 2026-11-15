import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Evita vários processos carregando o banco WASM ao mesmo tempo em máquinas menores.
  experimental: { cpus: 1 },
  staticPageGenerationTimeout: 180,
  // Dados persistentes não fazem parte do pacote; postbuild também valida no Windows.
  outputFileTracingExcludes: { "/*": ["./.data/**/*", "./storage/**/*", "./docs/**/*", "./detali-identidade/**/*"] },
  // PGlite (WASM) não deve passar pelo bundler do Next
  serverExternalPackages: ["@electric-sql/pglite", "drizzle-orm", "@pdf-lib/fontkit", "pdf-lib", "pdfjs-dist", "nodemailer", "qrcode"],
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
    ] }];
  },
};

export default nextConfig;
