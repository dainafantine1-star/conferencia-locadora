import { and, eq, sql, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiJobs, aiThreads, aiMessages, aiRules, aiAgents, aiActions, aiRuns, aiDeliveries, users, memberships, companies } from "@/lib/db/schema";
import { fail, lockCompany } from "@/lib/erp/common";
import { aiConfig, assertAllowed } from "./config";
import { sendWhatsApp, sendingHours } from "./channels";
import { externalReply } from "./runtime";
import type { SessionUser } from "@/lib/auth/session";

async function actor(companyId: string, userId: string): Promise<SessionUser> {
  const [row] = await db.select({ id: users.id, email: users.email, name: users.name, role: memberships.role, permissions: memberships.permissions, timezone: companies.timezone, companyName: companies.name })
    .from(users).innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.companyId, companyId)))
    .innerJoin(companies, eq(companies.id, memberships.companyId)).where(and(eq(users.id, userId), eq(users.active, true)));
  if (!row || row.role !== "gestor") fail("O responsável pela configuração não tem mais acesso de gestor", 403);
  return { ...row, companyId };
}
export async function runJobs(companyId?: string, limit = 3) {
  // Morte durante envio/modelo não autoriza repetição: exige inspeção humana.
  await db.update(aiJobs).set({ status: "verificar", error: "Processamento interrompido. Confira a conversa e o provedor antes de repetir." })
    .where(and(eq(aiJobs.status, "executando"), sql`${aiJobs.startedAt} < now() - interval '10 minutes'`, companyId ? eq(aiJobs.companyId, companyId) : undefined));
  await db.update(aiMessages).set({ status: "incerto", error: "Envio sem confirmação após interrupção. Confira o provedor." })
    .where(and(eq(aiMessages.status, "enviando"), sql`${aiMessages.createdAt} < now() - interval '10 minutes'`, companyId ? eq(aiMessages.companyId, companyId) : undefined));
  const results: { id: string; status: string }[] = [];
  for (let i = 0; i < limit; i++) {
    const job = await db.transaction(async tx => {
      const [next] = await tx.select().from(aiJobs).where(and(eq(aiJobs.status, "aguardando"), sql`${aiJobs.dueAt} <= now()`, companyId ? eq(aiJobs.companyId, companyId) : undefined))
        .orderBy(asc(aiJobs.dueAt)).limit(1).for("update", { skipLocked: true });
      if (!next) return null;
      const [running] = await tx.update(aiJobs).set({ status: "executando", startedAt: new Date() }).where(eq(aiJobs.id, next.id)).returning(); return running;
    });
    if (!job) break;
    const finish = async (status: string, error: string | null = null) => {
      await db.update(aiJobs).set({ status, error }).where(eq(aiJobs.id, job.id)); results.push({ id: job.id, status });
    };
    try {
      const [thread] = await db.select().from(aiThreads).where(and(eq(aiThreads.id, job.threadId), eq(aiThreads.companyId, job.companyId)));
      if (!thread || thread.status !== "aberto" || thread.optedOut) { await finish("cancelada", "Conversa fora do atendimento automático"); continue; }
      const [latest] = await db.select().from(aiMessages).where(and(eq(aiMessages.threadId, thread.id), eq(aiMessages.role, "user"))).orderBy(sql`${aiMessages.createdAt} desc`).limit(1);
      if (latest?.id !== job.messageId) { await finish("cancelada", "Uma mensagem mais recente substituiu este evento"); continue; }
      if (!thread.lastInboundAt || Date.now() - thread.lastInboundAt.getTime() >= 24 * 3600000) { await finish("cancelada", "Janela de atendimento encerrada"); continue; }
      const c = await aiConfig(job.companyId);
      let user: SessionUser; let reply: string; let automatic = false;
      if (job.kind === "rule") {
        const [rule] = await db.select().from(aiRules).where(and(eq(aiRules.id, job.ruleId!), eq(aiRules.companyId, job.companyId), eq(aiRules.active, true)));
        if (!rule) { await finish("cancelada", "Regra pausada ou indisponível"); continue; }
        user = await actor(job.companyId, rule.createdBy);
        if (rule.action === "humano") {
          await db.update(aiThreads).set({ status: "humano", updatedAt: new Date() }).where(eq(aiThreads.id, thread.id)); await finish("concluida"); continue;
        }
        reply = rule.text; automatic = rule.action === "enviar";
      } else {
        const [agent] = await db.select().from(aiAgents).where(and(eq(aiAgents.companyId, job.companyId), eq(aiAgents.channel, "whatsapp"), eq(aiAgents.active, true)));
        if (!agent) { await finish("cancelada", "Agente pausado"); continue; }
        user = await actor(job.companyId, agent.createdBy); automatic = agent.mode === "automatico";
        if (automatic && !sendingHours(c.preferences, user.timezone)) {
          await db.update(aiJobs).set({ status: "aguardando", dueAt: new Date(Date.now() + 15 * 60000), startedAt: null }).where(eq(aiJobs.id, job.id));
          results.push({ id: job.id, status: "adiada" }); continue;
        }
        reply = await externalReply(user, thread, agent, job.messageId!);
      }
      const [fresh] = await db.select().from(aiThreads).where(eq(aiThreads.id, thread.id));
      const [currentInbound] = await db.select({ id: aiMessages.id }).from(aiMessages).where(and(eq(aiMessages.threadId, thread.id), eq(aiMessages.role, "user"))).orderBy(sql`${aiMessages.createdAt} desc`).limit(1);
      if (currentInbound?.id !== job.messageId) { await finish("cancelada", "Nova mensagem recebida durante a preparação da resposta"); continue; }
      if (fresh.status !== "aberto" || fresh.optedOut) automatic = false;
      if (automatic && !sendingHours(c.preferences, user.timezone)) {
        await db.update(aiJobs).set({ status: "aguardando", dueAt: new Date(Date.now() + 15 * 60000), startedAt: null }).where(eq(aiJobs.id, job.id));
        results.push({ id: job.id, status: "adiada" }); continue;
      }
      if (automatic) {
        user = await actor(job.companyId, user.id);
        if (job.kind === "reply") {
          const [stillActive] = await db.select().from(aiAgents).where(and(eq(aiAgents.companyId, job.companyId), eq(aiAgents.channel, "whatsapp"), eq(aiAgents.active, true), eq(aiAgents.mode, "automatico")));
          if (!stillActive) { await finish("cancelada", "Agente pausado ou modo automático desativado durante a execução"); continue; }
        }
        const sent = await sendWhatsApp(user, { threadId: thread.id, text: reply.slice(0, 3000), requestKey: `job:${job.id}` }, true);
        if (!["aceita", "entregue", "lida"].includes(sent.message.status)) fail("O envio não teve confirmação de aceite", 502);
      }
      else await db.insert(aiMessages).values({ companyId: job.companyId, threadId: thread.id, role: "assistant", content: reply.slice(0, 6000), status: "rascunho", requestKey: `job:${job.id}`, metadata: { source: job.kind } }).onConflictDoNothing();
      await finish(automatic ? "concluida" : "rascunho");
    } catch {
      await finish("verificar", "A execução não concluiu. Verifique a configuração, a janela de atendimento, os limites e o provedor. Não há repetição automática de envio incerto.");
    }
  }
  return { results };
}
export async function runCompanyJobs(user: SessionUser) { assertAllowed(user, "gestor"); return runJobs(user.companyId); }
export async function cleanupHistory(user: SessionUser) {
  assertAllowed(user, "gestor"); const c = await aiConfig(user.companyId); const cutoff = new Date(Date.now() - (c.preferences.retentionDays ?? 180) * 86400000);
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const rows = await tx.select({ id: aiThreads.id }).from(aiThreads).where(and(eq(aiThreads.companyId, user.companyId), eq(aiThreads.status, "resolvido"), sql`${aiThreads.updatedAt} < ${cutoff.toISOString()}::timestamptz`));
    for (const { id } of rows) {
      await tx.delete(aiJobs).where(eq(aiJobs.threadId, id));
      await tx.delete(aiActions).where(eq(aiActions.threadId, id)); await tx.delete(aiRuns).where(eq(aiRuns.threadId, id));
      await tx.delete(aiMessages).where(eq(aiMessages.threadId, id)); await tx.delete(aiThreads).where(eq(aiThreads.id, id));
    }
    await tx.delete(aiDeliveries).where(and(eq(aiDeliveries.companyId, user.companyId), sql`${aiDeliveries.updatedAt} < ${cutoff.toISOString()}::timestamptz`));
    return { removedThreads: rows.length, cutoff: cutoff.toISOString() };
  });
}
