import { z } from "zod";
import { db } from "@/lib/db";
import { companySettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { emailValue, mediaValue, mediaUrl, fail, audit, lockCompany } from "./common";

export const secretKeys = ["smtpPassword", "pagbankToken", "whatsappToken", "zapsignToken"] as const;
export type Secrets = Partial<Record<typeof secretKeys[number], string>>;
export { encrypt, decrypt } from "./crypto";
import { encrypt, decrypt } from "./crypto";
const preferencesSchema = z.object({
  legalName: z.string().trim().max(300).optional(), taxId: z.string().trim().max(30).optional(),
  email: emailValue.optional(), phone: z.string().max(40).optional(), address: z.string().max(2000).optional(),
  contractTerms: z.string().max(30000).optional(), quoteValidityDays: z.number().int().min(1).max(365).optional(),
  commissionBasis: z.enum(["recebimento", "contrato"]).optional(), commissionBase: z.enum(["locacao", "total"]).optional(),
  defaultCommissionBps: z.number().int().min(0).max(10000).nullable().optional(),
  backupEnabled: z.boolean().optional(), backupHour: z.number().int().min(0).max(23).optional(),
  publicUrl: z.union([z.literal(""), z.url().refine(v => v.startsWith("https://"), "A URL pública deve usar HTTPS")]).optional(),
}).strict();
const storefrontSchema = z.object({
  enabled: z.boolean().optional(), title: z.string().max(200).optional(), description: z.string().max(3000).optional(),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), contactEmail: emailValue.optional(), contactPhone: z.string().max(40).optional(),
  bannerUrl: mediaValue.optional(), bannerTitle: z.string().max(200).optional(),
  banners: z.array(z.object({ imageUrl: mediaUrl, title: z.string().max(200),
    href: z.string().max(1000).refine(v => v === "" || v.startsWith("https://") || /^\/[a-zA-Z0-9/_-]*$/.test(v), "Link inválido").optional() })).max(8).optional(),
}).strict();
const integrationsSchema = z.object({
  smtpHost: z.string().trim().max(250).optional(), smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(), smtpUser: z.string().max(300).optional(), mailFrom: emailValue.optional(),
  pagbankEnvironment: z.enum(["sandbox", "production"]).optional(),
  whatsappPhoneId: z.string().regex(/^\d*$/).max(50).optional(), whatsappVersion: z.string().regex(/^$|^v\d+\.\d+$/).optional(),
  whatsappTemplate: z.string().regex(/^[a-z0-9_]*$/).max(100).optional(), whatsappLanguage: z.string().max(10).optional(),
  signatureEnvironment: z.enum(["sandbox", "production"]).optional(),
  signatureAuthMode: z.enum(["certificadoDigital", "assinaturaTela-tokenEmail"]).optional(),
}).strict();
const settingsSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(60).optional(),
  preferences: preferencesSchema.optional(), storefront: storefrontSchema.optional(), integrations: integrationsSchema.optional(),
  secrets: z.object({ smtpPassword: z.string().max(4000).optional(), pagbankToken: z.string().max(4000).optional(),
    whatsappToken: z.string().max(4000).optional(), zapsignToken: z.string().max(4000).optional() }).strict().optional(),
  removeSecrets: z.array(z.enum(secretKeys)).optional(),
}).strict();

export async function integrationConfig(companyId: string) {
  const [settings] = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId));
  const secrets: Secrets = settings?.encryptedSecrets ? JSON.parse(decrypt(settings.encryptedSecrets)) : {};
  return { settings, config: settings?.integrations ?? {}, secrets };
}
export async function settingsData(user: SessionUser) {
  const { settings, secrets, config } = await integrationConfig(user.companyId);
  return { slug: settings?.slug ?? "", preferences: settings?.preferences ?? {}, storefront: settings?.storefront ?? {}, integrations: config,
    secretStatus: Object.fromEntries(secretKeys.map(key => [key, Boolean(secrets[key])])),
    connectionStatus: {
      email: Boolean(config.smtpHost && config.smtpPort && config.mailFrom && secrets.smtpPassword),
      pagbank: Boolean(secrets.pagbankToken && settings?.preferences.publicUrl),
      whatsapp: Boolean(secrets.whatsappToken && config.whatsappPhoneId && config.whatsappVersion && config.whatsappTemplate),
      assinatura: Boolean(secrets.zapsignToken),
      backupScheduler: Boolean(process.env.CRON_SECRET),
    },
  };
}
export async function saveSettings(user: SessionUser, input: unknown) {
  const data = settingsSchema.parse(input);
  await db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [current] = await tx.select().from(companySettings).where(eq(companySettings.companyId, user.companyId));
    const previous: Secrets = current?.encryptedSecrets ? JSON.parse(decrypt(current.encryptedSecrets)) : {};
    const secrets = { ...previous };
    for (const key of secretKeys) if (data.secrets?.[key]) secrets[key] = data.secrets[key];
    for (const key of data.removeSecrets ?? []) delete secrets[key];
    const values = { slug: data.slug ?? current?.slug ?? null,
      preferences: { ...current?.preferences, ...data.preferences },
      storefront: { ...current?.storefront, ...data.storefront },
      integrations: { ...current?.integrations, ...data.integrations },
      encryptedSecrets: Object.keys(secrets).length ? encrypt(JSON.stringify(secrets)) : null, updatedAt: new Date() };
    if (values.storefront.enabled && !values.slug) fail("Defina o endereço da loja antes de ativá-la");
    if (values.slug) {
      const [duplicate] = await tx.select({ companyId: companySettings.companyId }).from(companySettings).where(eq(companySettings.slug, values.slug));
      if (duplicate && duplicate.companyId !== user.companyId) fail("Esse endereço de loja já está em uso");
    }
    await tx.insert(companySettings).values({ companyId: user.companyId, ...values })
      .onConflictDoUpdate({ target: companySettings.companyId, set: values });
    await audit(tx, user, "configuracoes_atualizadas", { sections: Object.keys(data).filter(k => k !== "secrets"), credentialKeys: Object.keys(data.secrets ?? {}) });
  });
  return settingsData(user);
}
