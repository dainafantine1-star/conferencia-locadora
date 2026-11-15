import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, isNull, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies, users, memberships, companyInvites, saasSubscriptions } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { SessionUser } from "@/lib/auth/session";
import { audit, fail, lockCompany, uuid } from "@/lib/erp/common";
import { ACTIONS, FEATURES } from "./catalog";
import { assertFeature, assertLimit, ensurePlans } from "./access";

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const grantsSchema = z.partialRecord(z.enum(FEATURES.map(f => f.id)), z.array(z.enum(ACTIONS)).max(ACTIONS.length)).nullable().default(null);
const emailSchema = z.email().max(300).transform(s => s.trim().toLowerCase());
const passwordSchema = z.string().min(12, "Use pelo menos 12 caracteres na senha").max(200);
const permissions = z.array(z.enum(["comercial", "financeiro", "logistica", "relatorios", "estoque", "clientes", "atendimento", "fiscal"])).default([]);
export async function registerCompany(input: unknown) {
  const body = z.object({ company: z.string().trim().min(2).max(200), name: z.string().trim().min(2).max(200), email: emailSchema, password: passwordSchema, planId: z.enum(["essencial", "plus"]).default("essencial") }).parse(input);
  await ensurePlans();
  const passwordHash = await hashPassword(body.password);
  return db.transaction(async tx => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, body.email));
    if (existing) fail("E-mail já cadastrado. Entre na conta para criar outra empresa.", 409);
    const [account] = await tx.insert(users).values({ email: body.email, name: body.name, passwordHash }).returning();
    const [company] = await tx.insert(companies).values({ name: body.company }).returning();
    await tx.insert(memberships).values({ companyId: company.id, userId: account.id, role: "gestor", accountRole: "owner" });
    await tx.insert(saasSubscriptions).values({ companyId: company.id, planId: body.planId, status: "trial" });
    return { company: { id: company.id, name: company.name }, user: { id: account.id, email: account.email } };
  });
}
export async function addCompany(user: SessionUser, input: unknown) {
  const body = z.object({ name: z.string().trim().min(2).max(200), planId: z.enum(["essencial", "plus"]).default("essencial") }).parse(input);
  await ensurePlans();
  return db.transaction(async tx => {
    const [company] = await tx.insert(companies).values({ name: body.name }).returning();
    await tx.insert(memberships).values({ userId: user.id, companyId: company.id, role: "gestor", accountRole: "owner" });
    await tx.insert(saasSubscriptions).values({ companyId: company.id, planId: body.planId, status: "trial" });
    return { company };
  });
}
export async function inviteMember(user: SessionUser, input: unknown) {
  await assertFeature(user, "users", "create");
  if (user.role !== "gestor") fail("Somente proprietários e administradores podem convidar a equipe", 403);
  const body = z.object({ email: emailSchema, accountRole: z.enum(["admin", "member"]), permissions, grants: grantsSchema }).parse(input);
  const token = randomBytes(32).toString("hex");
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [duplicate] = await tx.select({ id: memberships.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.companyId, user.companyId), eq(users.email, body.email)));
    if (duplicate) fail("Pessoa já participa desta empresa; altere seu acesso na equipe.", 409);
    const [pending] = await tx.select({ id: companyInvites.id }).from(companyInvites).where(and(eq(companyInvites.companyId, user.companyId), eq(companyInvites.email, body.email), isNull(companyInvites.acceptedAt), isNull(companyInvites.revokedAt), gt(companyInvites.expiresAt, new Date())));
    if (pending) fail("Já existe convite válido para este e-mail. Revogue o anterior para emitir outro.", 409);
    await assertLimit(tx, user.companyId, "users", 1);
    const [invite] = await tx.insert(companyInvites).values({ ...body, companyId: user.companyId, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 7 * 86400000), createdBy: user.id }).returning();
    await audit(tx, user, "convite_criado", { id: invite.id, email: body.email, accountRole: body.accountRole });
    return { id: invite.id, token, path: `/convite/${token}`, expiresAt: invite.expiresAt, delivery: "Compartilhe o link com a pessoa convidada. Nenhum e-mail foi enviado automaticamente." };
  });
}
export async function inviteInfo(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) fail("Convite inválido", 404);
  const [invite] = await db.select({ id: companyInvites.id, companyId: companyInvites.companyId, email: companyInvites.email, companyName: companies.name, expiresAt: companyInvites.expiresAt, acceptedAt: companyInvites.acceptedAt, revokedAt: companyInvites.revokedAt }).from(companyInvites)
    .innerJoin(companies, eq(companies.id, companyInvites.companyId)).where(eq(companyInvites.tokenHash, tokenHash(token)));
  if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt < new Date()) fail("Convite expirado, utilizado ou revogado", 410);
  return invite;
}
export async function acceptInvite(token: string, input: unknown) {
  const body = z.object({ name: z.string().trim().min(2).max(200), email: emailSchema, password: passwordSchema }).parse(input);
  const info = await inviteInfo(token);
  if (body.email !== info.email) fail("Use o e-mail que recebeu o convite", 403);
  // Existing users must prove possession of their account; an invitation never resets a password.
  const [existing] = await db.select().from(users).where(eq(users.email, body.email));
  if (existing && (!existing.active || !await verifyPassword(body.password, existing.passwordHash))) fail("E-mail ou senha inválidos", 403);
  const passwordHash = existing ? null : await hashPassword(body.password);
  await assertFeature({ id: (await db.select({ createdBy: companyInvites.createdBy }).from(companyInvites).where(eq(companyInvites.id, info.id)))[0].createdBy, companyId: info.companyId } as SessionUser, "users", "create");
  return db.transaction(async tx => {
    await lockCompany(tx, info.companyId);
    const [invite] = await tx.select().from(companyInvites).where(eq(companyInvites.id, info.id)).for("update");
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt < new Date()) fail("Convite expirado, utilizado ou revogado", 410);
    // The pending invitation already consumes one seat.
    await assertLimit(tx, info.companyId, "users", 0);
    const account = existing ?? (await tx.insert(users).values({ email: body.email, name: body.name, passwordHash: passwordHash! }).returning())[0];
    await tx.insert(memberships).values({ userId: account.id, companyId: info.companyId, role: invite.accountRole === "admin" ? "gestor" : "operador", accountRole: invite.accountRole, permissions: invite.permissions, grants: invite.grants }).onConflictDoNothing();
    await tx.update(companyInvites).set({ acceptedAt: new Date() }).where(eq(companyInvites.id, info.id));
    return { accepted: true, companyId: info.companyId };
  });
}
export async function revokeInvite(user: SessionUser, input: unknown) {
  await assertFeature(user, "users", "edit");
  const { id } = z.object({ id: uuid }).parse(input);
  const [row] = await db.update(companyInvites).set({ revokedAt: new Date() }).where(and(eq(companyInvites.id, id), eq(companyInvites.companyId, user.companyId), isNull(companyInvites.acceptedAt))).returning();
  if (!row) fail("Convite não encontrado", 404);
  return { ok: true };
}
export async function updateAccess(user: SessionUser, input: unknown) {
  await assertFeature(user, "users", "edit");
  const body = z.object({ userId: uuid, accountRole: z.enum(["owner", "admin", "member"]), active: z.boolean(), permissions, grants: grantsSchema }).parse(input);
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [actor] = await tx.select().from(memberships).where(and(eq(memberships.userId, user.id), eq(memberships.companyId, user.companyId)));
    if (actor.role !== "gestor") fail("Somente proprietários e administradores podem alterar acessos", 403);
    const [target] = await tx.select().from(memberships).where(and(eq(memberships.userId, body.userId), eq(memberships.companyId, user.companyId)));
    if (!target) fail("Usuário não encontrado", 404);
    if ((body.accountRole === "owner" || target.accountRole === "owner") && actor.accountRole !== "owner") fail("Somente o proprietário pode alterar proprietários", 403);
    if (body.userId === user.id && (!body.active || body.accountRole !== actor.accountRole || JSON.stringify(body.grants) !== JSON.stringify(actor.grants))) fail("Peça a outro proprietário para alterar seu próprio acesso");
    if (target.accountRole === "owner" && (!body.active || body.accountRole !== "owner")) {
      const owners = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.companyId, user.companyId), eq(memberships.accountRole, "owner"), eq(memberships.active, true)));
      if (owners.length <= 1) fail("A empresa deve manter ao menos um proprietário ativo", 409);
    }
    if (!target.active && body.active) await assertLimit(tx, user.companyId, "users", 1);
    await tx.update(memberships).set({ accountRole: body.accountRole, role: body.accountRole === "member" ? "operador" : "gestor", active: body.active, permissions: body.permissions, grants: body.grants }).where(eq(memberships.id, target.id));
    await audit(tx, user, "acesso_saas_atualizado", body);
    return { ok: true };
  });
}
export async function accountMembers(user: SessionUser) {
  await assertFeature(user, "users");
  const [members, invites] = await Promise.all([
    db.select({ userId: users.id, name: users.name, email: users.email, accountRole: memberships.accountRole, active: memberships.active, grants: memberships.grants, permissions: memberships.permissions }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.companyId, user.companyId)),
    db.select({ id: companyInvites.id, email: companyInvites.email, accountRole: companyInvites.accountRole, expiresAt: companyInvites.expiresAt, acceptedAt: companyInvites.acceptedAt, revokedAt: companyInvites.revokedAt }).from(companyInvites).where(eq(companyInvites.companyId, user.companyId)),
  ]);
  return { members, invites };
}
