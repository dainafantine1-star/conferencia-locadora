import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db, isEmbedded } from "@/lib/db";
import { aiSettings, aiRuns } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { audit, fail, lockCompany } from "@/lib/erp/common";
import { encrypt, decrypt } from "@/lib/erp/crypto";
import type { AiSecret, AiPreferences } from "./types";

export const aiSecretKeys = ["aiKey", "metaToken", "metaAppSecret", "verifyToken", "wahaKey", "wahaWebhookSecret"] as const;
const prefsSchema = z.object({
  provider: z.enum(["gateway", "openai", "anthropic", "google", "openrouter"]).optional(),
  model: z.string().trim().max(180).optional(), dailyRuns: z.number().int().min(1).max(10000).optional(),
  maxOutputTokens: z.number().int().min(256).max(8192).optional(),
  whatsappProvider: z.enum(["meta", "waha"]).optional(), phoneId: z.string().regex(/^\d*$/).max(60).optional(),
  graphVersion: z.string().regex(/^$|^v\d+\.\d+$/).optional(),
  wahaUrl: z.union([z.literal(""), z.url()]).optional(), wahaSession: z.string().regex(/^[\w-]*$/).max(100).optional(),
  startHour: z.number().int().min(0).max(23).optional(), endHour: z.number().int().min(1).max(24).optional(),
  dailyMessages: z.number().int().min(1).max(5000).optional(), retentionDays: z.number().int().min(30).max(730).optional(),
}).strict();
const saveSchema = z.object({ preferences: prefsSchema.optional(),
  secrets: z.object(Object.fromEntries(aiSecretKeys.map(k => [k, z.string().max(5000).optional()]))).strict().optional(),
  removeSecrets: z.array(z.enum(aiSecretKeys)).optional(),
}).strict();
export function allowed(user: SessionUser, permission: string) {
  return user.role === "gestor" || user.permissions?.includes(permission as never) === true;
}
export function assertAllowed(user: SessionUser, permission: string) { if (!allowed(user, permission)) fail("Seu perfil não tem permissão para esta operação", 403); }
export async function aiConfig(companyId: string) {
  const [row] = await db.select().from(aiSettings).where(eq(aiSettings.companyId, companyId));
  return { preferences: row?.preferences ?? {} as AiPreferences, secrets: row?.encryptedSecrets ? JSON.parse(decrypt(row.encryptedSecrets)) as Partial<Record<AiSecret, string>> : {} };
}
export function wahaBase(value: string | undefined) {
  if (!value) fail("Configure o endereço do WAHA", 503);
  const url = new URL(value);
  const hosts = (process.env.WAHA_ALLOWED_HOSTS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/" || !hosts.includes(url.hostname)) {
    fail("O host do WAHA precisa estar autorizado em WAHA_ALLOWED_HOSTS no servidor", 503);
  }
  return url.origin;
}
export async function configurationData(user: SessionUser) {
  assertAllowed(user, "gestor");
  const c = await aiConfig(user.companyId);
  const [usage] = await db.select({ runs: sql<number>`count(*)::int`, input: sql<number>`coalesce(sum(${aiRuns.inputTokens}),0)::float8`, output: sql<number>`coalesce(sum(${aiRuns.outputTokens}),0)::float8` })
    .from(aiRuns).where(and(eq(aiRuns.companyId, user.companyId), sql`${aiRuns.createdAt} >= date_trunc('day', now())`));
  return { preferences: c.preferences, secretStatus: Object.fromEntries(aiSecretKeys.map(k => [k, !!c.secrets[k]])),
    aiReady: !!(c.preferences.model && c.secrets.aiKey), whatsappReady: c.preferences.whatsappProvider === "waha"
      ? !!(c.preferences.wahaUrl && c.preferences.wahaSession && c.secrets.wahaKey && c.secrets.wahaWebhookSecret)
      : !!(c.preferences.phoneId && c.preferences.graphVersion && c.secrets.metaToken && c.secrets.metaAppSecret && c.secrets.verifyToken),
    workerConfigured: !!process.env.CRON_SECRET, database: isEmbedded() ? "local" : "postgres", usage,
    webhookPath: `/api/atendimento/webhook/${user.companyId}` };
}
export async function saveConfiguration(user: SessionUser, input: unknown) {
  assertAllowed(user, "gestor"); const data = saveSchema.parse(input);
  await db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [row] = await tx.select().from(aiSettings).where(eq(aiSettings.companyId, user.companyId));
    const secrets: Partial<Record<AiSecret, string>> = row?.encryptedSecrets ? JSON.parse(decrypt(row.encryptedSecrets)) : {};
    for (const k of aiSecretKeys) if (data.secrets?.[k]) secrets[k] = data.secrets[k] as string;
    for (const k of data.removeSecrets ?? []) delete secrets[k];
    const preferences = { ...row?.preferences, ...data.preferences };
    if ((preferences.startHour ?? 8) >= (preferences.endHour ?? 20)) fail("O fim do horário de envio deve ser posterior ao início");
    if (preferences.wahaUrl) preferences.wahaUrl = wahaBase(preferences.wahaUrl);
    const others = await tx.select({ companyId: aiSettings.companyId, preferences: aiSettings.preferences }).from(aiSettings);
    if (others.some(r => r.companyId !== user.companyId && (
      preferences.whatsappProvider === "meta" && preferences.phoneId && r.preferences.whatsappProvider === "meta" && r.preferences.phoneId === preferences.phoneId ||
      preferences.whatsappProvider === "waha" && preferences.wahaSession && r.preferences.whatsappProvider === "waha" && r.preferences.wahaUrl === preferences.wahaUrl && r.preferences.wahaSession === preferences.wahaSession
    ))) fail("Essa conexão já está vinculada a outra empresa. Use um número ou sessão exclusivo.", 409);
    const values = { preferences, encryptedSecrets: encrypt(JSON.stringify(secrets)), updatedAt: new Date() };
    await tx.insert(aiSettings).values({ companyId: user.companyId, ...values }).onConflictDoUpdate({ target: aiSettings.companyId, set: values });
    await audit(tx, user, "assistencia_configurada", { credentialKeys: Object.keys(data.secrets ?? {}), preferenceKeys: Object.keys(data.preferences ?? {}) });
  });
  return configurationData(user);
}
