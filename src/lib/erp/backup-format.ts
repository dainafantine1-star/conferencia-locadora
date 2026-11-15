import { gunzipSync } from "node:zlib";
import { decrypt } from "./crypto";
import { z } from "zod";
function fail(message: string): never { throw new Error(message); }
const uuid = z.uuid();
export type BackupPayload = { format: "detali-v1"; companyId: string; createdAt: string; tables: Record<string, Record<string, unknown>[]>; files: { key: string; base64: string }[] };
export function decodeBackup(content: string) {
  const raw = gunzipSync(Buffer.from(decrypt(content), "base64"), { maxOutputLength: 512 * 1024 * 1024 }).toString("utf8");
  const parsed = JSON.parse(raw) as BackupPayload;
  if (parsed.format !== "detali-v1" || !parsed.tables || !Array.isArray(parsed.files)) fail("Backup inválido");
  uuid.parse(parsed.companyId);
  return parsed;
}
