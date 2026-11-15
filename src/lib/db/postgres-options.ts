import type { PoolConfig } from "pg";
import certificate from "./certs/supabase-root-2021.json";

/** Supabase poolers use their own CA. Verify it and the hostname explicitly. */
export function postgresOptions(connectionString: string): PoolConfig {
  const url = new URL(connectionString);
  const host = url.hostname.toLowerCase();
  const supabase = host.endsWith(".pooler.supabase.com") || /^db\.[a-z0-9]+\.supabase\.co$/.test(host);
  if (!supabase) return { connectionString };
  const mode = url.searchParams.get("sslmode");
  if (mode && !["require", "verify-ca", "verify-full"].includes(mode)) throw new Error("A conexão Supabase exige TLS com certificado verificado");
  // pg connection-string SSL parameters replace an explicit ssl object.
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: { ca: certificate.pem, rejectUnauthorized: true } };
}
