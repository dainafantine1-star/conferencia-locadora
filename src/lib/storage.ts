import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { AuthError } from "@/lib/auth/session";
type BucketKind = "files" | "backups";
function checkedKey(companyId: string, name: string) {
  if (!/^[a-f0-9-]{36}$/.test(companyId) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(name) || name.includes("..")) throw new AuthError("Caminho de arquivo inválido", 400);
  return `${companyId}/${name}`;
}
export function storageProvider() { return process.env.STORAGE_PROVIDER === "supabase" ? "supabase" : "local"; }
function remoteConfig(kind: BucketKind) {
  const base = process.env.SUPABASE_URL, token = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !token) throw new AuthError("Armazenamento Supabase aguardando configuração", 503);
  const url = new URL(base); if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") throw new AuthError("URL do Supabase inválida", 503);
  const bucket = kind === "backups" ? process.env.SUPABASE_BACKUP_BUCKET ?? "detali-backups" : process.env.SUPABASE_STORAGE_BUCKET ?? "detali-files";
  if (!/^[a-z0-9-]+$/.test(bucket)) throw new AuthError("Bucket inválido", 503);
  return { url: url.origin, token, bucket };
}
function localRoot(kind: BucketKind) { return path.resolve(kind === "backups" ? process.env.BACKUP_DIR ?? "storage/backups" : process.env.STORAGE_DIR ?? "storage"); }
export async function putPrivateFile(companyId: string, name: string, bytes: Buffer, mime: string, kind: BucketKind = "files") {
  const key = checkedKey(companyId, name);
  if (storageProvider() === "supabase") {
    const c = remoteConfig(kind);
    const response = await fetch(`${c.url}/storage/v1/object/${c.bucket}/${key}`, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${c.token}`, apikey: c.token, "Content-Type": mime, "x-upsert": "false" }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new AuthError("Não foi possível gravar no armazenamento privado", 502);
  } else {
    const full = kind === "backups" ? path.join(localRoot(kind), name) : path.join(localRoot(kind), key);
    await mkdir(path.dirname(full), { recursive: true }); await writeFile(full, bytes, { flag: "wx", mode: 0o600 });
  }
  return key;
}
export async function getPrivateFile(companyId: string, name: string, kind: BucketKind = "files") {
  const key = checkedKey(companyId, name);
  if (storageProvider() === "supabase") {
    const c = remoteConfig(kind);
    const response = await fetch(`${c.url}/storage/v1/object/authenticated/${c.bucket}/${key}`, { redirect: "error", cache: "no-store", headers: { Authorization: `Bearer ${c.token}`, apikey: c.token }, signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new AuthError(response.status === 404 ? "Arquivo ausente" : "Falha ao ler armazenamento privado", response.status === 404 ? 404 : 502);
    const maximum = kind === "backups" ? 512 * 1024 * 1024 : 10 * 1024 * 1024;
    const { boundedBytes } = await import("@/lib/fiscal/provider"); return Buffer.from(await boundedBytes(response, maximum));
  }
  const full = kind === "backups" ? path.join(localRoot(kind), name) : path.join(localRoot(kind), key);
  try { return await readFile(full); } catch { throw new AuthError("Arquivo ausente", 404); }
}
