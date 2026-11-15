import { and, eq, sql, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies, memberships, users, saasPlans, saasSubscriptions, companyInvites } from "@/lib/db/schema";
import { AuthError, type SessionUser } from "@/lib/auth/session";
import { FEATURES, featureById, allFeatures, openLimits, type FeatureId, type AccessAction, type LimitKey } from "./catalog";

export async function ensurePlans() {
  await db.insert(saasPlans).values([
    { id: "essencial", name: "Essencial", monthlyCents: 5000, features: allFeatures(), limits: openLimits(), support: { channels: [], slaHours: null, phoneByAppointment: true } },
    { id: "plus", name: "Plus", monthlyCents: null, features: allFeatures(), limits: openLimits(), support: { channels: [], slaHours: null, phoneByAppointment: true } },
  ]).onConflictDoNothing();
}
export async function entitlement(companyId: string) {
  const [existing] = await db.select({ subscription: saasSubscriptions, plan: saasPlans }).from(saasSubscriptions)
    .innerJoin(saasPlans, eq(saasPlans.id, saasSubscriptions.planId)).where(eq(saasSubscriptions.companyId, companyId));
  if (existing) return existing;
  await ensurePlans();
  await db.insert(saasSubscriptions).values({ companyId, planId: "essencial", status: "trial" }).onConflictDoNothing();
  const [row] = await db.select({ subscription: saasSubscriptions, plan: saasPlans }).from(saasSubscriptions)
    .innerJoin(saasPlans, eq(saasPlans.id, saasSubscriptions.planId)).where(eq(saasSubscriptions.companyId, companyId));
  if (!row) throw new AuthError("Assinatura não encontrada", 403);
  return row;
}
export function allowedAction(user: SessionUser, feature: FeatureId, action: AccessAction) {
  const definition = featureById(feature);
  if (!definition) return false;
  if (user.grants) return Boolean(user.grants[feature]?.includes(action));
  if (user.accountRole === "owner" || user.accountRole === "admin" || user.role === "gestor") return true;
  // Legacy operators always had access to physical conference. Explicit grants can restrict it.
  const permitted = feature === "returns" || !definition.permission || user.permissions?.includes(definition.permission as never);
  return Boolean(permitted && action !== "delete" && (action !== "financial" || user.permissions?.includes("financeiro")));
}
export async function assertFeature(user: SessionUser, feature: FeatureId, action: AccessAction = "view") {
  // Reload grants on every operation, including commands proposed earlier by the assistant.
  const [member] = await db.select({ role: memberships.role, accountRole: memberships.accountRole, grants: memberships.grants, permissions: memberships.permissions })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.companyId, user.companyId), eq(memberships.userId, user.id), eq(memberships.active, true), eq(users.active, true)));
  if (!member) throw new AuthError("Acesso à empresa revogado", 403);
  if (!allowedAction({ ...user, ...member }, feature, action)) throw new AuthError("Seu perfil não permite esta ação neste recurso", 403);
  return assertPlan(user.companyId, feature, action);
}
export async function assertPlan(companyId: string, feature: FeatureId, action: AccessAction = "view") {
  const access = await entitlement(companyId);
  if (!access.plan.features[feature]) throw new AuthError(`${featureById(feature)?.name}: recurso indisponível no plano ${access.plan.name}. Os dados existentes foram preservados.`, 403);
  if (action !== "view" && (!["trial", "active"].includes(access.subscription.status) || access.subscription.startsAt > new Date() || (access.subscription.endsAt && access.subscription.endsAt < new Date())))
    throw new AuthError("Sua assinatura permite somente consulta. Fale com a Detali para regularizar novas operações.", 403);
  return access;
}
export async function accountContext(user: SessionUser) {
  const access = await entitlement(user.companyId);
  const accounts = await db.select({ id: companies.id, name: companies.name, accountRole: memberships.accountRole }).from(memberships)
    .innerJoin(companies, eq(companies.id, memberships.companyId)).where(and(eq(memberships.userId, user.id), eq(memberships.active, true)));
  return { ...access, accounts, companyId: user.companyId, accountRole: user.accountRole, userId: user.id,
    features: FEATURES.map(f => ({ ...f, enabled: Boolean(access.plan.features[f.id]), actions: ["view", "create", "edit", "delete", "financial"].filter(a => allowedAction(user, f.id, a as AccessAction)) })) };
}
// Must run under the company row lock: a check and its write form one transaction.
export async function assertLimit(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], companyId: string, key: LimitKey, additional: number) {
  const [row] = await tx.select({ limits: saasPlans.limits }).from(saasSubscriptions).innerJoin(saasPlans, eq(saasPlans.id, saasSubscriptions.planId)).where(eq(saasSubscriptions.companyId, companyId));
  const limit = row?.limits[key];
  if (limit === null || limit === undefined) return;
  let used = 0;
  if (key === "users") {
    const a = await tx.execute(sql`select count(*)::int as n from memberships where company_id = ${companyId}::uuid and active`);
    const b = await tx.select({ id: companyInvites.id }).from(companyInvites).where(and(eq(companyInvites.companyId, companyId), isNull(companyInvites.acceptedAt), isNull(companyInvites.revokedAt), gt(companyInvites.expiresAt, new Date())));
    used = Number(a.rows[0]?.n ?? 0) + b.length;
  } else if (key === "venues") {
    const a = await tx.execute(sql`select count(*)::int as n from product_records where company_id = ${companyId}::uuid and module = 'locais' and status <> 'arquivado'`); used = Number(a.rows[0]?.n ?? 0);
  } else {
    const a = await tx.execute(sql`select count(*)::int as n from checkin_records where company_id = ${companyId}::uuid and date_trunc('month', created_at at time zone 'America/Bahia') = date_trunc('month', now() at time zone 'America/Bahia')`); used = Number(a.rows[0]?.n ?? 0);
  }
  const label = { users: "usuários", checkins_month: "participantes no mês", venues: "locais" }[key];
  if (used + additional > limit) throw new AuthError(`Limite de ${label} do plano atingido: ${used} de ${limit}. Os registros existentes serão mantidos.`, 403);
}
