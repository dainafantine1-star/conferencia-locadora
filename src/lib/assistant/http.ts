import { NextRequest } from "next/server";
import { fail } from "@/lib/erp/common";
export function assertOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("host"); const configured = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : null;
    let originHost = "";
    try { originHost = new URL(origin).host; } catch { fail("Origem não autorizada", 403); }
    if (originHost !== host && origin !== configured) fail("Origem não autorizada", 403);
  }
}
export async function readJson(req: NextRequest, maxBytes = 150000) {
  assertOrigin(req);
  const text = await boundedBody(req, maxBytes); const result = JSON.parse(text);
  if (!result || typeof result !== "object" || Array.isArray(result)) fail("JSON inválido");
  return result as Record<string, unknown>;
}
export async function boundedBody(req: NextRequest, maxBytes: number) {
  return Buffer.from(await boundedBytes(req, maxBytes)).toString("utf8");
}
export async function boundedBytes(req: NextRequest, maxBytes: number) {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) fail("Conteúdo excede o limite", 413);
  const reader = req.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); fail("Conteúdo excede o limite", 413); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  return new Uint8Array(Buffer.concat(chunks));
}
