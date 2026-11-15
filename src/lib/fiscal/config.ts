import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { fiscalSettings, fiscalInvoices, memberships, users, catalogItems } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { encrypt, decrypt } from "@/lib/erp/crypto";
import { audit, lockCompany, fail } from "@/lib/erp/common";
import { defaultPreferences, preferencesSchema, checkedAddress, validFederalId } from "./validation";
import type { FiscalEnvironment } from "./types";

export async function fiscalAccess(user: SessionUser, manager = false) {
  const [membership] = await db.select({ role: memberships.role, permissions: memberships.permissions }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, user.id), eq(memberships.companyId, user.companyId), eq(users.active, true)));
  if (!membership || membership.role !== "gestor" && (manager || !membership.permissions.includes("fiscal"))) fail(manager ? "Apenas gestores podem configurar a emissão fiscal" : "Seu perfil não tem permissão para notas fiscais", 403);
  return { ...user, ...membership };
}
type FiscalSecrets = Partial<Record<FiscalEnvironment, string>>;
export async function fiscalConfig(companyId: string) {
  const [row] = await db.select().from(fiscalSettings).where(eq(fiscalSettings.companyId, companyId));
  return { preferences: row?.preferences ?? structuredClone(defaultPreferences), secrets: row?.encryptedSecrets ? JSON.parse(decrypt(row.encryptedSecrets)) as FiscalSecrets : {} };
}
export function emitterReady(p: typeof defaultPreferences) {
  try { checkedAddress(p.emitter, "emitente"); return p.emitter.taxId.length === 14 && validFederalId(p.emitter.taxId) && !!p.emitter.name && !!p.emitter.stateRegistration; } catch { return false; }
}
export async function fiscalSettingsData(user: SessionUser) {
  await fiscalAccess(user, true); const c = await fiscalConfig(user.companyId);
  return { preferences: c.preferences, secretStatus: { homologacao: !!c.secrets.homologacao, producao: !!c.secrets.producao }, emitterReady: emitterReady(c.preferences) };
}
export async function saveFiscalSettings(user: SessionUser, input: unknown) {
  user = await fiscalAccess(user, true);
  const data = z.object({ preferences: preferencesSchema, secrets: z.object({ homologacao: z.string().max(5000).optional(), producao: z.string().max(5000).optional() }).strict().optional(), removeSecrets: z.array(z.enum(["homologacao", "producao"])).optional() }).strict().parse(input);
  await db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [row] = await tx.select().from(fiscalSettings).where(eq(fiscalSettings.companyId, user.companyId));
    if (row?.preferences.emitter.taxId && row.preferences.emitter.taxId !== data.preferences.emitter.taxId) {
      const [used] = await tx.select({ id: fiscalInvoices.id }).from(fiscalInvoices).where(and(eq(fiscalInvoices.companyId, user.companyId), ne(fiscalInvoices.status, "rascunho"))).limit(1);
      if (used) fail("O CNPJ emitente possui emissões vinculadas. Cadastre outra empresa para outro emitente.", 409);
    }
    const products = await tx.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.companyId, user.companyId));
    const ids = new Set(products.map(x => x.id)); if (data.preferences.products.some(p => !ids.has(p.catalogItemId))) fail("Produto fiscal não pertence à empresa", 404);
    const secrets: FiscalSecrets = row?.encryptedSecrets ? JSON.parse(decrypt(row.encryptedSecrets)) : {};
    for (const key of ["homologacao", "producao"] as const) if (data.secrets?.[key]?.trim()) secrets[key] = data.secrets[key]!.trim();
    for (const key of data.removeSecrets ?? []) delete secrets[key];
    if (data.preferences.productionEnabled && (!emitterReady(data.preferences) || !secrets.producao || !data.preferences.profiles.some(p => p.active && p.reviewed))) fail("Complete o emitente, o token de produção e um perfil revisado antes de liberar produção");
    await tx.insert(fiscalSettings).values({ companyId: user.companyId, preferences: data.preferences, encryptedSecrets: encrypt(JSON.stringify(secrets)) })
      .onConflictDoUpdate({ target: fiscalSettings.companyId, set: { preferences: data.preferences, encryptedSecrets: encrypt(JSON.stringify(secrets)), updatedAt: new Date() } });
    await audit(tx, user, "fiscal_configurada", { environment: data.preferences.environment, productionEnabled: data.preferences.productionEnabled, profiles: data.preferences.profiles.map(p => p.id), credentialKeys: Object.keys(data.secrets ?? {}) });
  });
  return fiscalSettingsData(user);
}
export function fiscalToken(config: Awaited<ReturnType<typeof fiscalConfig>>, environment: FiscalEnvironment) {
  const token = config.secrets[environment]; if (!token) fail(`Configure o token Focus NFe de ${environment === "producao" ? "produção" : "homologação"}`, 503); return token;
}
