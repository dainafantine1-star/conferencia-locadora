import { assertFeature } from "@/lib/saas/access";
import { z } from "zod";
import { and, eq, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiAgents, aiThreads, aiMessages, aiRules, aiJobs, aiRuns, memberships, users } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { uuid, audit, fail, lockCompany } from "@/lib/erp/common";
import { assertAllowed } from "./config";

const agentSchema = z.object({ id: uuid.optional(), name: z.string().trim().min(2).max(100),
  instructions: z.string().max(16000), channel: z.enum(["interno", "whatsapp"]), mode: z.enum(["assistido", "automatico"]),
  active: z.boolean(), keywords: z.array(z.string().trim().min(2).max(60)).max(30).default(["atendente", "humano"]) }).strict();
export async function saveAgent(user: SessionUser, input: unknown) {
  await assertFeature(user, "attendance", "edit");
  assertAllowed(user, "gestor"); const data = agentSchema.parse(input);
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    if (data.active) {
      const [other] = await tx.select().from(aiAgents).where(and(eq(aiAgents.companyId, user.companyId), eq(aiAgents.channel, data.channel), eq(aiAgents.active, true)));
      if (other && other.id !== data.id) fail("Pause o agente ativo deste canal antes de publicar outro", 409);
    }
    const { id, ...values } = data;
    if (id) {
      const [old] = await tx.select().from(aiAgents).where(and(eq(aiAgents.id, id), eq(aiAgents.companyId, user.companyId)));
      if (!old) fail("Agente não encontrado", 404);
      await audit(tx, user, "agente_versionado", { id, previousVersion: old.version, previousInstructions: old.instructions, previousMode: old.mode });
    }
    const [agent] = id ? await tx.update(aiAgents).set({ ...values, version: sql`${aiAgents.version} + 1`, updatedAt: new Date() }).where(and(eq(aiAgents.id, id), eq(aiAgents.companyId, user.companyId))).returning()
      : await tx.insert(aiAgents).values({ ...values, companyId: user.companyId, createdBy: user.id }).returning();
    await audit(tx, user, "agente_salvo", { id: agent.id, version: agent.version, active: agent.active, mode: agent.mode });
    return { agent };
  });
}
export async function agentsData(user: SessionUser) {
  await assertFeature(user, "attendance", "view");
  assertAllowed(user, "gestor");
  const [agents, runs] = await Promise.all([
    db.select().from(aiAgents).where(eq(aiAgents.companyId, user.companyId)).orderBy(aiAgents.name),
    db.select().from(aiRuns).where(eq(aiRuns.companyId, user.companyId)).orderBy(desc(aiRuns.createdAt)).limit(50),
  ]); return { agents, runs };
}
const ruleSchema = z.object({ id: uuid.optional(), name: z.string().trim().min(2).max(120), active: z.boolean(),
  trigger: z.enum(["nova_conversa", "mensagem_recebida", "sem_resposta"]), keyword: z.string().max(120).default(""),
  delayMinutes: z.number().int().min(0).max(10080), action: z.enum(["rascunho", "enviar", "humano"]), text: z.string().max(3000).default("") }).strict();
export async function saveRule(user: SessionUser, input: unknown) {
  await assertFeature(user, "attendance", "edit");
  assertAllowed(user, "gestor"); const data = ruleSchema.parse(input);
  if (data.action !== "humano" && !data.text.trim()) fail("Informe a mensagem da automação");
  if (data.trigger === "sem_resposta" && data.delayMinutes < 5) fail("O acompanhamento precisa aguardar pelo menos cinco minutos");
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const { id, ...values } = data;
    const [rule] = id ? await tx.update(aiRules).set(values).where(and(eq(aiRules.id, id), eq(aiRules.companyId, user.companyId))).returning()
      : await tx.insert(aiRules).values({ ...values, companyId: user.companyId, createdBy: user.id }).returning();
    if (!rule) fail("Regra não encontrada", 404);
    await audit(tx, user, "automacao_salva", { ruleId: rule.id, active: rule.active, action: rule.action }); return { rule };
  });
}
export async function rulesData(user: SessionUser) {
  await assertFeature(user, "attendance", "view");
  assertAllowed(user, "gestor");
  return { rules: await db.select().from(aiRules).where(eq(aiRules.companyId, user.companyId)).orderBy(aiRules.name),
    jobs: await db.select().from(aiJobs).where(eq(aiJobs.companyId, user.companyId)).orderBy(desc(aiJobs.createdAt)).limit(100) };
}
export async function internalThread(user: SessionUser, id?: string) {
  if (id) {
    const [thread] = await db.select().from(aiThreads).where(and(eq(aiThreads.id, uuid.parse(id)), eq(aiThreads.companyId, user.companyId), eq(aiThreads.userId, user.id), eq(aiThreads.channel, "interno")));
    if (!thread) fail("Conversa não encontrada", 404); return thread;
  }
  const [thread] = await db.insert(aiThreads).values({ companyId: user.companyId, userId: user.id, channel: "interno", name: "Assistente Detali" }).returning();
  return thread;
}
export async function ownHistory(user: SessionUser, id: string) {
  const thread = await internalThread(user, id);
  const messages = await db.select().from(aiMessages).where(and(eq(aiMessages.companyId, user.companyId), eq(aiMessages.threadId, id))).orderBy(desc(aiMessages.createdAt)).limit(60);
  return { thread, messages: messages.reverse() };
}
export async function inboxData(user: SessionUser, threadId?: string) {
  await assertFeature(user, "attendance", "view");
  assertAllowed(user, "atendimento");
  const threads = await db.select().from(aiThreads).where(and(eq(aiThreads.companyId, user.companyId), eq(aiThreads.channel, "whatsapp"))).orderBy(desc(aiThreads.updatedAt)).limit(100);
  let messages: typeof aiMessages.$inferSelect[] = [];
  if (threadId) {
    uuid.parse(threadId);
    const [found] = await db.select().from(aiThreads).where(and(eq(aiThreads.id, threadId), eq(aiThreads.companyId, user.companyId), eq(aiThreads.channel, "whatsapp")));
    if (!found) fail("Conversa não encontrada", 404);
    messages = (await db.select().from(aiMessages).where(and(eq(aiMessages.companyId, user.companyId), eq(aiMessages.threadId, threadId))).orderBy(desc(aiMessages.createdAt)).limit(100)).reverse();
  }
  const team = await db.select({ id: users.id, name: users.name }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.companyId, user.companyId), eq(users.active, true)));
  return { threads, messages, team };
}
export async function updateThread(user: SessionUser, input: unknown) {
  await assertFeature(user, "attendance", "edit");
  assertAllowed(user, "atendimento");
  const data = z.object({ id: uuid, status: z.enum(["aberto", "humano", "resolvido"]), assignedTo: uuid.nullable().optional() }).strict().parse(input);
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    if (data.assignedTo) {
      const [member] = await tx.select().from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.companyId, user.companyId), eq(users.id, data.assignedTo), eq(users.active, true)));
      if (!member) fail("Responsável não encontrado na empresa");
    }
    const [thread] = await tx.update(aiThreads).set({ status: data.status, assignedTo: data.assignedTo, updatedAt: new Date() }).where(and(eq(aiThreads.id, data.id), eq(aiThreads.companyId, user.companyId), eq(aiThreads.channel, "whatsapp"))).returning();
    if (!thread) fail("Conversa não encontrada", 404);
    await audit(tx, user, "atendimento_transferido", { threadId: thread.id, status: thread.status, assignedTo: thread.assignedTo });
    return { thread };
  });
}
