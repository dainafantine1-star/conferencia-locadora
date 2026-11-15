import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformAdmins, platformAudit, saasPlans, saasSubscriptions, companies, users, productRecords } from "@/lib/db/schema";
import { AuthError, type SessionUser } from "@/lib/auth/session";
import { uuid } from "@/lib/erp/common";
import { FEATURES, LIMITS, allFeatures } from "./catalog";
import { ensurePlans } from "./access";
export async function isPlatformAdmin(userId: string) {
  const [row] = await db.select({ id: platformAdmins.userId }).from(platformAdmins).innerJoin(users, eq(users.id, platformAdmins.userId)).where(and(eq(platformAdmins.userId, userId), eq(users.active, true)));
  return Boolean(row);
}
export async function assertPlatform(user: SessionUser) { if (!await isPlatformAdmin(user.id)) throw new AuthError("Acesso exclusivo da administração Detali", 403); }
export async function platformData(user: SessionUser) {
  await assertPlatform(user); await ensurePlans();
  return {
    catalog: FEATURES, limits: LIMITS,
    plans: await db.select().from(saasPlans).orderBy(saasPlans.id),
    companies: await db.select({ id: companies.id, name: companies.name, createdAt: companies.createdAt, subscription: saasSubscriptions }).from(companies).leftJoin(saasSubscriptions, eq(saasSubscriptions.companyId, companies.id)).orderBy(desc(companies.createdAt)),
    audit: await db.select().from(platformAudit).orderBy(desc(platformAudit.createdAt)).limit(100),
    tickets: await db.select({ id: productRecords.id, companyId: productRecords.companyId, companyName: companies.name, title: productRecords.title, data: productRecords.data, status: productRecords.status }).from(productRecords).innerJoin(companies, eq(companies.id, productRecords.companyId)).where(eq(productRecords.module, "suporte")).orderBy(desc(productRecords.updatedAt)).limit(200),
  };
}
export async function answerSupport(user: SessionUser, input: unknown) {
  await assertPlatform(user);
  const body = z.object({ id: uuid, reply: z.string().trim().min(1).max(10000), status: z.enum(["ativo", "em_atendimento", "resolvido"]) }).parse(input);
  return db.transaction(async tx => {
    const [ticket] = await tx.select().from(productRecords).where(and(eq(productRecords.id, body.id), eq(productRecords.module, "suporte"))).for("update");
    if (!ticket) throw new AuthError("Solicitação não encontrada", 404);
    const replies = [...(ticket.data.replies as { message: string; at: string }[] ?? []), { message: body.reply, at: new Date().toISOString() }].slice(-100);
    await tx.update(productRecords).set({ data: { ...ticket.data, replies }, status: body.status, updatedAt: new Date() }).where(eq(productRecords.id, ticket.id));
    await tx.insert(platformAudit).values({ userId: user.id, action: "suporte_respondido", payload: { id: ticket.id, companyId: ticket.companyId, status: body.status } }); return { ok: true };
  });
}
export async function savePlan(user: SessionUser, input: unknown) {
  await assertPlatform(user);
  const body = z.object({ id: z.enum(["essencial", "plus"]), monthlyCents: z.number().int().min(0).max(99999999).nullable(),
    features: z.record(z.enum(FEATURES.map(f => f.id)), z.boolean()),
    limits: z.object({ users: z.number().int().min(0).nullable(), checkins_month: z.number().int().min(0).nullable(), venues: z.number().int().min(0).nullable() }),
    support: z.object({ channels: z.array(z.string().trim().min(1).max(100)).max(10), slaHours: z.number().int().min(1).max(8760).nullable(), phoneByAppointment: z.boolean() }),
  }).parse(input);
  if (Object.keys(body.features).length !== FEATURES.length) throw new AuthError("Informe a matriz completa de recursos", 400);
  return db.transaction(async tx => {
    await tx.update(saasPlans).set({ ...body, features: { ...allFeatures(), ...body.features }, updatedAt: new Date() }).where(eq(saasPlans.id, body.id));
    await tx.insert(platformAudit).values({ userId: user.id, action: "plano_atualizado", payload: body });
    return { ok: true };
  });
}
export async function assignSubscription(user: SessionUser, input: unknown) {
  await assertPlatform(user); await ensurePlans();
  const body = z.object({ companyId: uuid, planId: z.enum(["essencial", "plus"]), status: z.enum(["trial", "active", "past_due", "suspended", "cancelled"]), cycle: z.enum(["monthly", "yearly", "manual"]), startsAt: z.iso.datetime(), endsAt: z.iso.datetime().nullable() }).parse(input);
  if (body.endsAt && body.endsAt <= body.startsAt) throw new AuthError("A data final deve ser posterior ao início", 400);
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, body.companyId));
  if (!company) throw new AuthError("Empresa não encontrada", 404);
  const values = { ...body, startsAt: new Date(body.startsAt), endsAt: body.endsAt ? new Date(body.endsAt) : null, updatedAt: new Date() };
  return db.transaction(async tx => {
    await tx.insert(saasSubscriptions).values(values).onConflictDoUpdate({ target: saasSubscriptions.companyId, set: values });
    await tx.insert(platformAudit).values({ userId: user.id, action: "assinatura_atribuida_manualmente", payload: body });
    return { ok: true, billing: "Atribuição manual. Nenhuma cobrança foi realizada." };
  });
}
