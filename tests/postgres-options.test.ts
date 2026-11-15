import { describe, expect, it } from "vitest";
import { X509Certificate } from "node:crypto";
import { postgresOptions } from "../src/lib/db/postgres-options";
import certificate from "../src/lib/db/certs/supabase-root-2021.json";

describe("conexão PostgreSQL com certificado Supabase", () => {
  it("verifica o certificado oficial e remove parâmetros que substituem a validação TLS", () => {
    const options = postgresOptions("postgresql://postgres.projeto:test-only@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require&sslrootcert=wrong.crt&application_name=detali");
    expect(options.ssl).toEqual({ ca: certificate.pem, rejectUnauthorized: true });
    const url = new URL(options.connectionString!);
    expect(url.searchParams.has("sslmode")).toBe(false);
    expect(url.searchParams.has("sslrootcert")).toBe(false);
    expect(url.searchParams.get("application_name")).toBe("detali");
    expect(url.password).toBe("test-only");
  });
  it("também protege a conexão direta e não confunde domínios parecidos", () => {
    expect(postgresOptions("postgresql://postgres:test-only@db.abc123.supabase.co:5432/postgres").ssl).toEqual({ ca: certificate.pem, rejectUnauthorized: true });
    const external = "postgresql://postgres:test-only@aws.pooler.supabase.com.example.test:5432/postgres";
    expect(postgresOptions(external)).toEqual({ connectionString: external });
  });
  it("recusa modos que permitem conexão sem criptografia", () => {
    for (const mode of ["disable", "allow", "prefer"]) expect(() => postgresOptions(`postgresql://postgres:test-only@db.abc123.supabase.co/postgres?sslmode=${mode}`)).toThrow(/exige TLS/);
  });
  it("o certificado público incluído é uma autoridade válida com fingerprint conferido", () => {
    const ca = new X509Certificate(certificate.pem);
    expect(ca.ca).toBe(true);
    expect(ca.fingerprint256.replaceAll(":", "").toLowerCase()).toBe(certificate.sha256);
    expect(Date.parse(ca.validTo)).toBeGreaterThan(Date.now());
  });
});
