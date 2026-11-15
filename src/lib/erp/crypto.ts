import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
export class CredentialError extends Error {}
function configurationFailure(message: string): never { throw new CredentialError(message); }
function encryptionKey() {
  const secret = process.env.APP_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) configurationFailure("Configure APP_ENCRYPTION_KEY ou AUTH_SECRET com pelo menos 32 caracteres");
  return createHash("sha256").update(`detali-secrets-v1:${secret}`).digest();
}
export function encrypt(value: string) {
  const nonce = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const payload = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64"), cipher.getAuthTag().toString("base64"), payload.toString("base64")].join(".");
}
export function decrypt(value: string) {
  const [version, nonce, tag, payload] = value.split(".");
  if (version !== "v1" || !nonce || !tag || !payload) configurationFailure("Credencial criptografada inválida");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(nonce, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload, "base64")), decipher.final()]).toString("utf8");
}
