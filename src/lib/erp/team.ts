import { assertFeature, assertLimit } from "@/lib/saas/access";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, memberships } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { fail, uuid, audit, lockCompany } from "./common";

const fields = z.object({ name: z.string().trim().min(1).max(300), role: z.enum(["gestor", "operador"]),
  permissions: z.array(z.enum(["comercial", "financeiro", "logistica", "relatorios", "estoque", "clientes", "atendimento", "fiscal"])).max(8).default([]),
  commissionBps: z.number().int().min(0).max(10000).nullable().default(null), active: z.boolean().default(true) });
const createSchema = fields.extend({ email: z.email(), password: z.string().min(12, "Use pelo menos 12 caracteres").max(200) });
export async function teamData(user: SessionUser) {
  await assertFeature(user, "users", "view");
  const members = await db.select({ id: users.id, name: users.name, email: users.email, role: memberships.role,
    permissions: memberships.permissions, commissionBps: memberships.commissionBps, active: memberships.active })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.companyId, user.companyId));
  return { members, currentUserId: user.id };
}
export async function createMember(user: SessionUser, input: unknown) {
  await assertFeature(user, "users", "create");
  const body = createSchema.parse(input); const email = body.email.trim().toLowerCase(); const passwordHash = await hashPassword(body.password);
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    await assertLimit(tx, user.companyId, "users", 1);
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) fail("E-mail já cadastrado");
    const [created] = await tx.insert(users).values({ email, name: body.name, passwordHash, active: true }).returning();
    await tx.insert(memberships).values({ userId: created.id, companyId: user.companyId, role: body.role, accountRole: body.role === "gestor" ? "admin" : "member", active: body.active, permissions: body.permissions, commissionBps: body.commissionBps });
    await audit(tx, user, "usuario_criado", { id: created.id, role: body.role, permissions: body.permissions });
    return { member: { id: created.id, name: created.name, email: created.email } };
  });
}
export async function updateMember(user: SessionUser, input: unknown) {
  await assertFeature(user, "users", "edit");
  const body = fields.extend({ id: uuid, password: z.string().min(12).max(200).optional() }).parse(input);
  const passwordHash = body.password ? await hashPassword(body.password) : undefined;
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [membership] = await tx.select().from(memberships).where(and(eq(memberships.companyId, user.companyId), eq(memberships.userId, body.id))).for("update");
    if (!membership) fail("Usuário não encontrado", 404);
    if (membership.accountRole === "owner" && (body.role !== "gestor" || !body.active)) fail("Altere a propriedade pela área Conta e plano, mantendo um proprietário ativo", 409);
    if (membership.accountRole === "owner" && user.accountRole !== "owner" && body.id !== user.id) fail("Somente proprietários podem alterar o acesso de outro proprietário", 403);
    if (body.id === user.id && (!body.active || body.role !== "gestor")) fail("Peça a outro gestor para alterar seu próprio acesso");
    if (!body.active || body.role !== "gestor") {
      const managers = await tx.select({ id: users.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.companyId, user.companyId), eq(memberships.role, "gestor"), eq(users.active, true), eq(memberships.active, true)));
      if (membership.role === "gestor" && managers.filter(m => m.id !== body.id).length === 0) fail("A empresa deve manter ao menos um gestor ativo");
    }
    const allMemberships = await tx.select({ companyId: memberships.companyId }).from(memberships).where(eq(memberships.userId, body.id));
    const [account] = await tx.select().from(users).where(eq(users.id, body.id));
    if (allMemberships.some(m => m.companyId !== user.companyId) && (passwordHash || account.name !== body.name)) fail("Conta compartilhada entre empresas; alterações de nome e senha exigem o titular da conta");
    if (!membership.active && body.active) await assertLimit(tx, user.companyId, "users", 1);
    await tx.update(users).set({ name: body.name,
      ...(passwordHash ? { authVersion: sql`${users.authVersion} + 1` } : {}),
      ...(passwordHash ? { passwordHash } : {}) }).where(eq(users.id, body.id));
    await tx.update(memberships).set({ role: body.role, accountRole: membership.accountRole === "owner" ? "owner" : body.role === "gestor" ? "admin" : "member", active: body.active, permissions: body.permissions, commissionBps: body.commissionBps }).where(eq(memberships.id, membership.id));
    await audit(tx, user, "acesso_atualizado", { id: body.id, role: body.role, active: body.active, permissions: body.permissions, passwordReset: Boolean(passwordHash) });
    return { ok: true };
  });
}
