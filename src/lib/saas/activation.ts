import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, companies, memberships, platformAdmins, platformAudit, saasSubscriptions } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { tokenHash } from "./accounts";
import { ensurePlans } from "./access";
import { fail } from "@/lib/erp/common";
// Called only from the administrative CLI, never exposed as a public provisioning endpoint.
export async function provisionPlatformAdmin(email: string) {
  const normalized = z.email().parse(email.trim().toLowerCase()); await ensurePlans();
  const [existing] = await db.select().from(users).where(eq(users.email, normalized));
  if (existing) {
    if (!existing.active) {
      const [pending] = await db.select({ id: platformAudit.id }).from(platformAudit).where(and(eq(platformAudit.userId, existing.id), eq(platformAudit.action, "ativacao_plataforma_pendente")));
      if (!pending) fail("Já existe uma conta inativa com este e-mail. Recupere o acesso existente antes de conceder o perfil.", 409);
      const token = randomBytes(32).toString("hex"), expiresAt = new Date(Date.now() + 86400000);
      await db.update(platformAudit).set({ payload: { tokenHash: tokenHash(token), expiresAt: expiresAt.toISOString() } }).where(eq(platformAudit.id, pending.id));
      return { existing: false, userId: existing.id, path: `/ativar-administrador/${token}`, expiresAt: expiresAt.toISOString() };
    }
    await db.insert(platformAdmins).values({ userId: existing.id }).onConflictDoNothing();
    await db.insert(platformAudit).values({ userId: existing.id, action: "administrador_concedido_por_cli", payload: { email: normalized } });
    return { existing: true, userId: existing.id, path: "/admin-detali" };
  }
  const token = randomBytes(32).toString("hex"), unusableHash = await hashPassword(randomBytes(48).toString("base64")), expiresAt = new Date(Date.now() + 86400000);
  return db.transaction(async tx => {
    const [account] = await tx.insert(users).values({ email: normalized, name: "Administrador Detali", passwordHash: unusableHash, active: false }).returning();
    const [workspace] = await tx.insert(companies).values({ name: "Administração Detali" }).returning();
    await tx.insert(memberships).values({ companyId: workspace.id, userId: account.id, role: "gestor", accountRole: "owner" });
    await tx.insert(saasSubscriptions).values({ companyId: workspace.id, planId: "plus", status: "active", cycle: "manual" });
    await tx.insert(platformAudit).values({ userId: account.id, action: "ativacao_plataforma_pendente", payload: { tokenHash: tokenHash(token), expiresAt: expiresAt.toISOString() } });
    return { existing: false, userId: account.id, path: `/ativar-administrador/${token}`, expiresAt: expiresAt.toISOString() };
  });
}
export async function activationInfo(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) fail("Ativação inválida", 404);
  const [row] = await db.select({ id: platformAudit.id, userId: users.id, email: users.email, active: users.active, payload: platformAudit.payload }).from(platformAudit).innerJoin(users, eq(users.id, platformAudit.userId))
    .where(and(eq(platformAudit.action, "ativacao_plataforma_pendente"), sql`${platformAudit.payload}->>'tokenHash' = ${tokenHash(token)}`));
  const payload = row?.payload as { expiresAt?: string } | undefined;
  if (!row || row.active || !payload?.expiresAt || new Date(payload.expiresAt) < new Date()) fail("Ativação expirada ou já utilizada", 410);
  return { id: row.id, userId: row.userId, email: row.email };
}
export async function activatePlatform(token: string, input: unknown) {
  const body = z.object({ password: z.string().min(12).max(200) }).parse(input); const info = await activationInfo(token);
  const passwordHash = await hashPassword(body.password);
  return db.transaction(async tx => {
    const [account] = await tx.select().from(users).where(eq(users.id, info.userId)).for("update");
    const [record] = await tx.select().from(platformAudit).where(eq(platformAudit.id, info.id)).for("update");
    const payload = record?.payload as { expiresAt?: string } | undefined;
    if (!account || account.active || !record || record.action !== "ativacao_plataforma_pendente" || !payload?.expiresAt || new Date(payload.expiresAt) < new Date()) fail("Ativação expirada ou já utilizada", 410);
    await tx.update(users).set({ active: true, passwordHash, authVersion: sql`${users.authVersion} + 1` }).where(eq(users.id, account.id));
    await tx.insert(platformAdmins).values({ userId: account.id }).onConflictDoNothing();
    await tx.update(platformAudit).set({ action: "ativacao_plataforma_concluida", payload: { activatedAt: new Date().toISOString() } }).where(eq(platformAudit.id, record.id));
    await tx.insert(platformAudit).values({ userId: account.id, action: "administrador_ativado", payload: {} });
    return { activated: true, email: account.email };
  });
}
