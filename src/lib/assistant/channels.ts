import { assertFeature } from "@/lib/saas/access";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { and, eq, sql, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiThreads, aiMessages, aiJobs, aiRules, aiAgents, aiDeliveries, companySettings, fiscalDeliveries } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { fail, lockCompany, uuid, audit } from "@/lib/erp/common";
import { aiConfig, wahaBase, assertAllowed } from "./config";
import { normalized } from "./help";

export const constantEqual = (a: string, b: string) => !!a && !!b && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function validSignature(raw: string, signature: string | null, secret: string | undefined, algorithm: "sha256" | "sha512") {
  if (!signature || !secret) return false;
  return constantEqual(signature.replace(new RegExp(`^${algorithm}=`), ""), createHmac(algorithm, secret).update(raw).digest("hex"));
}
export function sendingHours(preferences: { startHour?: number; endHour?: number }, timezone: string, now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
  return hour >= (preferences.startHour ?? 8) && hour < (preferences.endHour ?? 20);
}
async function recordDelivery(companyId: string, externalId: string, status: string) {
  await db.transaction(async tx => {
    await lockCompany(tx, companyId);
    const [old] = await tx.select().from(aiDeliveries).where(and(eq(aiDeliveries.companyId, companyId), eq(aiDeliveries.externalId, externalId)));
    const ranks: Record<string, number> = { aceita: 1, entregue: 2, lida: 3 };
    const next = !old || (ranks[status] ?? 0) >= (ranks[old.status] ?? 0) || status === "falhou" && !["entregue", "lida"].includes(old.status) ? status : old.status;
    await tx.insert(aiDeliveries).values({ companyId, externalId, status: next }).onConflictDoUpdate({ target: [aiDeliveries.companyId, aiDeliveries.externalId], set: { status: next, updatedAt: new Date() } });
    await tx.update(aiMessages).set({ status: next }).where(and(eq(aiMessages.companyId, companyId), eq(aiMessages.externalId, externalId)));
    await tx.update(fiscalDeliveries).set({ status: next }).where(and(eq(fiscalDeliveries.companyId, companyId), eq(fiscalDeliveries.providerId, externalId)));
  });
}
export async function receiveMessage(companyId: string, input: { id: string; from: string; name: string; text: string; timestamp: Date; media?: string; provider: "meta" | "waha" }): Promise<{ threadId?: string; queued?: boolean; ignored?: boolean; duplicate?: boolean; human?: boolean }> {
  if (!/^\d{8,16}$/.test(input.from) || !input.id || input.id.length > 300) return { ignored: true };
  return db.transaction(async tx => {
    await lockCompany(tx, companyId);
    const externalId = `${input.provider}:${input.id}`;
    const [duplicate] = await tx.select({ id: aiMessages.id }).from(aiMessages).where(and(eq(aiMessages.companyId, companyId), eq(aiMessages.externalId, externalId)));
    if (duplicate) return { duplicate: true };
    const externalKey = `${input.provider}:${input.from}`;
    const [prior] = await tx.select().from(aiThreads).where(and(eq(aiThreads.companyId, companyId), eq(aiThreads.channel, "whatsapp"), eq(aiThreads.externalKey, externalKey)));
    // Um evento antigo não reabre a janela de atendimento nem reverte o opt-out.
    const recent = Date.now() - input.timestamp.getTime() < 24 * 3600000 && input.timestamp.getTime() <= Date.now() + 60000;
    const isNewer = !prior?.lastInboundAt || input.timestamp > prior.lastInboundAt;
    const stop = /^(stop|parar|sair|cancelar mensagens|nao quero receber)$/i.test(normalized(input.text).trim());
    const resume = /^(voltar|retomar|quero receber)$/i.test(normalized(input.text).trim());
    const optedOut = isNewer ? stop || (!!prior?.optedOut && !resume) : !!prior?.optedOut;
    const [thread] = await tx.insert(aiThreads).values({ companyId, channel: "whatsapp", externalKey, phone: input.from, name: input.name.slice(0, 200), lastInboundAt: input.timestamp,
      optedOut, status: input.media ? "humano" : "aberto" }).onConflictDoUpdate({ target: [aiThreads.companyId, aiThreads.channel, aiThreads.externalKey], set: {
        ...(isNewer ? { lastInboundAt: input.timestamp, optedOut } : {}), updatedAt: new Date(),
        status: input.media || optedOut ? "humano" : prior?.status === "resolvido" && recent && isNewer ? "aberto" : prior?.status ?? "aberto",
      } }).returning();
    const [message] = await tx.insert(aiMessages).values({ companyId, threadId: thread.id, role: "user", content: (input.text || `[Mensagem ${input.media ?? "sem texto"}: revisão humana necessária]`).slice(0, 16000),
      externalId, metadata: { provider: input.provider, receivedAt: input.timestamp.toISOString(), ...(input.media ? { mediaType: input.media } : {}) } }).returning();
    if (!recent || !isNewer || optedOut || input.media || thread.status === "humano") return { threadId: thread.id, queued: false };
    const [agent] = await tx.select().from(aiAgents).where(and(eq(aiAgents.companyId, companyId), eq(aiAgents.channel, "whatsapp"), eq(aiAgents.active, true)));
    const asksHuman = agent?.keywords.some(k => normalized(input.text).includes(normalized(k)));
    if (asksHuman) {
      await tx.update(aiThreads).set({ status: "humano" }).where(eq(aiThreads.id, thread.id)); return { threadId: thread.id, queued: false, human: true };
    }
    const rules = await tx.select().from(aiRules).where(and(eq(aiRules.companyId, companyId), eq(aiRules.active, true)));
    let matched = false;
    for (const rule of rules) {
      if (rule.trigger === "nova_conversa" && prior) continue;
      if (rule.keyword && !normalized(input.text).includes(normalized(rule.keyword))) continue;
      matched = matched || rule.trigger !== "sem_resposta";
      await tx.insert(aiJobs).values({ companyId, threadId: thread.id, messageId: message.id, ruleId: rule.id, kind: "rule", requestKey: `${message.id}:${rule.id}`,
        payload: { lastInboundId: message.id }, dueAt: new Date(Date.now() + rule.delayMinutes * 60000) }).onConflictDoNothing();
    }
    // Regra explícita tem precedência sobre resposta de IA para evitar duas respostas automáticas.
    if (agent && !matched) await tx.insert(aiJobs).values({ companyId, threadId: thread.id, messageId: message.id, kind: "reply", requestKey: `reply:${message.id}` }).onConflictDoNothing();
    return { threadId: thread.id, queued: !!agent || matched };
  });
}
const metaEnvelope = z.object({ entry: z.array(z.object({ changes: z.array(z.object({ value: z.object({
  metadata: z.object({ phone_number_id: z.string() }).optional(),
  contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }).optional() })).optional(),
  messages: z.array(z.object({ id: z.string(), from: z.string(), timestamp: z.string(), type: z.string(), text: z.object({ body: z.string() }).optional() }).passthrough()).optional(),
  statuses: z.array(z.object({ id: z.string(), status: z.string() }).passthrough()).optional(),
}).passthrough() })) })) }).passthrough();
export async function ingestWebhook(companyId: string, raw: string, headers: Headers) {
  uuid.parse(companyId); const c = await aiConfig(companyId);
  if (c.preferences.whatsappProvider === "waha") {
    const signature = headers.get("x-webhook-hmac");
    const secret = c.secrets.wahaWebhookSecret;
    const authentic = signature ? validSignature(raw, signature, secret, "sha512") : !!secret && secret.length >= 32 && constantEqual(headers.get("x-detali-webhook-token") ?? "", secret);
    if (!authentic) fail("Webhook não autenticado", 401);
    const body = z.object({ session: z.string(), event: z.string(), payload: z.object({ id: z.string().optional(), from: z.string().optional(), body: z.string().optional(), fromMe: z.boolean().optional(), timestamp: z.number().optional(), hasMedia: z.boolean().optional(), type: z.string().optional() }).passthrough() }).parse(JSON.parse(raw));
    if (body.session !== c.preferences.wahaSession) fail("Sessão de WhatsApp diferente da configurada", 403);
    if (!["message", "message.any"].includes(body.event) || body.payload.fromMe) return { ignored: true };
    const p = body.payload; const from = p.from?.match(/^(\d+)@(c\.us|s\.whatsapp\.net)$/)?.[1];
    if (!from || !p.id || !p.timestamp) return { ignored: true };
    const timestamp = new Date(p.timestamp * 1000); if (!Number.isFinite(timestamp.getTime())) fail("Data de mensagem inválida");
    return receiveMessage(companyId, { id: p.id, from, name: from, text: p.body ?? "", timestamp, media: p.hasMedia ? p.type ?? "arquivo" : undefined, provider: "waha" });
  }
  if (!validSignature(raw, headers.get("x-hub-signature-256"), c.secrets.metaAppSecret, "sha256")) fail("Webhook não autenticado", 401);
  const body = metaEnvelope.parse(JSON.parse(raw)); let processed = 0;
  for (const entry of body.entry) for (const { value } of entry.changes) {
    if (value.metadata?.phone_number_id !== c.preferences.phoneId) continue;
    for (const status of value.statuses ?? []) {
      if (!["sent", "delivered", "read", "failed"].includes(status.status)) continue;
      const next = { sent: "aceita", delivered: "entregue", read: "lida", failed: "falhou" }[status.status]!;
      await recordDelivery(companyId, `meta:${status.id}`, next);
    }
    for (const m of value.messages ?? []) {
      const timestamp = new Date(Number(m.timestamp) * 1000); if (!Number.isFinite(timestamp.getTime())) continue;
      await receiveMessage(companyId, { id: m.id, from: m.from, name: value.contacts?.find(c => c.wa_id === m.from)?.profile?.name ?? m.from,
        text: m.type === "text" ? m.text?.body ?? "" : "", timestamp, media: m.type !== "text" ? m.type : undefined, provider: "meta" }); processed++;
    }
  }
  return { processed };
}
class SendFailure extends Error { constructor(public definitive: boolean) { super("O serviço de WhatsApp não confirmou o envio"); } }
export async function sendWhatsApp(user: SessionUser, input: unknown, automatic = false) {
  await assertFeature(user, "attendance", "edit");
  if (!automatic) assertAllowed(user, "atendimento");
  const data = z.object({ threadId: uuid, text: z.string().trim().min(1).max(3000), requestKey: z.string().min(16).max(160), draftId: uuid.optional() }).strict().parse(input);
  const c = await aiConfig(user.companyId); const p = c.preferences; const provider = p.whatsappProvider ?? "meta";
  if (provider === "meta" && (!p.phoneId || !p.graphVersion || !c.secrets.metaToken)) fail("WhatsApp oficial aguardando configuração", 503);
  if (provider === "waha" && (!p.wahaSession || !c.secrets.wahaKey)) fail("WAHA aguardando configuração", 503);
  const base = provider === "waha" ? wahaBase(p.wahaUrl) : "https://graph.facebook.com";
  const prepared = await db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [previous] = await tx.select().from(aiMessages).where(and(eq(aiMessages.companyId, user.companyId), eq(aiMessages.requestKey, data.requestKey)));
    if (previous) return { message: previous, thread: null };
    const [thread] = await tx.select().from(aiThreads).where(and(eq(aiThreads.id, data.threadId), eq(aiThreads.companyId, user.companyId), eq(aiThreads.channel, "whatsapp"))).for("update");
    if (!thread || !thread.phone || !thread.externalKey?.startsWith(`${provider}:`)) fail("Conversa não pertence à conexão atual", 404);
    if (thread.optedOut) fail("Este contato pediu para não receber mensagens", 409);
    if (automatic && thread.status !== "aberto") fail("Atendimento automático suspenso nesta conversa", 409);
    if (!thread.lastInboundAt || Date.now() - thread.lastInboundAt.getTime() >= 24 * 3600000) fail("Janela de atendimento encerrada. Use um template aprovado ou aguarde nova mensagem do cliente.", 409);
    if (automatic && !sendingHours(p, user.timezone)) fail("Fora do horário configurado para envio automático", 409);
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(aiMessages).where(and(eq(aiMessages.companyId, user.companyId), inArray(aiMessages.status, ["enviando", "aceita", "entregue", "lida", "incerto"]), sql`${aiMessages.createdAt} >= date_trunc('day', now())`));
    if (count.n >= (p.dailyMessages ?? 100)) fail("Limite diário de mensagens atingido", 429);
    const [recent] = await tx.select({ id: aiMessages.id }).from(aiMessages).where(and(eq(aiMessages.companyId, user.companyId), inArray(aiMessages.status, ["enviando", "aceita", "incerto"]), sql`${aiMessages.createdAt} > now() - interval '6 seconds'`)).limit(1);
    if (recent) fail("Aguarde alguns segundos antes do próximo envio", 429);
    if (data.draftId) {
      const [draft] = await tx.select().from(aiMessages).where(and(eq(aiMessages.id, data.draftId), eq(aiMessages.companyId, user.companyId), eq(aiMessages.threadId, thread.id), eq(aiMessages.status, "rascunho"))).for("update");
      if (!draft) fail("Rascunho já enviado ou indisponível", 409);
      await tx.update(aiMessages).set({ status: "revisado" }).where(eq(aiMessages.id, draft.id));
    }
    const [message] = await tx.insert(aiMessages).values({ companyId: user.companyId, threadId: thread.id, role: automatic ? "assistant" : "humano", content: data.text, requestKey: data.requestKey, status: "enviando" }).returning();
    if (!automatic) await audit(tx, user, "mensagem_whatsapp_autorizada", { threadId: thread.id, messageId: message.id });
    return { message, thread };
  });
  if (!prepared.thread) return { message: prepared.message, duplicate: true };
  try {
    const response = await fetch(provider === "meta" ? `${base}/${p.graphVersion}/${p.phoneId}/messages` : `${base}/api/sendText`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", ...(provider === "meta" ? { Authorization: `Bearer ${c.secrets.metaToken}` } : { "X-Api-Key": c.secrets.wahaKey! }) },
      body: JSON.stringify(provider === "meta" ? { messaging_product: "whatsapp", to: prepared.thread.phone, type: "text", text: { body: data.text } }
        : { session: p.wahaSession, chatId: `${prepared.thread.phone}@c.us`, text: data.text }),
    });
    if (!response.ok) throw new SendFailure([400, 401, 403, 404, 405, 413, 415, 422, 429].includes(response.status));
    const result = await response.json(); const id = provider === "meta" ? result.messages?.[0]?.id : typeof result.id === "string" ? result.id : result.id?._serialized;
    if (typeof id !== "string" || !id) throw new SendFailure(false);
    // O webhook pode chegar antes desta gravação: o recibo persistido é reconciliado sob o mesmo lock.
    const message = await db.transaction(async tx => {
      await lockCompany(tx, user.companyId);
      const [delivery] = await tx.select().from(aiDeliveries).where(and(eq(aiDeliveries.companyId, user.companyId), eq(aiDeliveries.externalId, `${provider}:${id}`)));
      const [row] = await tx.update(aiMessages).set({ status: delivery?.status ?? "aceita", externalId: `${provider}:${id}` }).where(eq(aiMessages.id, prepared.message.id)).returning(); return row;
    });
    return { message };
  } catch (error) {
    const status = error instanceof SendFailure && error.definitive ? "falhou" : "incerto";
    await db.update(aiMessages).set({ status, error: "Consulte o provedor antes de repetir um envio sem confirmação." }).where(eq(aiMessages.id, prepared.message.id));
    fail(status === "incerto" ? "Envio incerto. Confira o provedor antes de repetir." : "O provedor recusou o envio. Confira a configuração.", 502);
  }
}
export async function connectionStatus(user: SessionUser, start = false) {
  assertAllowed(user, "gestor"); const c = await aiConfig(user.companyId); const p = c.preferences;
  if (p.whatsappProvider !== "waha") {
    if (!p.phoneId || !p.graphVersion || !c.secrets.metaToken) fail("Configure a conexão oficial primeiro", 503);
    const r = await fetch(`https://graph.facebook.com/${p.graphVersion}/${p.phoneId}?fields=id,display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${c.secrets.metaToken}` }, signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!r.ok) fail("A Meta não confirmou acesso ao número. Confira token, versão e permissões.", 502);
    const value = await r.json(); return { provider: "meta", status: "credencial_verificada", number: value.display_phone_number, name: value.verified_name, notice: "O webhook e a entrega precisam ser homologados separadamente." };
  }
  const base = wahaBase(p.wahaUrl); if (!p.wahaSession || !c.secrets.wahaKey) fail("Configure a sessão e a chave WAHA", 503);
  const headers = { "X-Api-Key": c.secrets.wahaKey, "Content-Type": "application/json" };
  const call = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, headers, signal: AbortSignal.timeout(15000), redirect: "error" });
  const sessionPath = `/api/sessions/${encodeURIComponent(p.wahaSession)}`;
  let r = await call(sessionPath);
  if (start && r.status === 404) {
    const [settings] = await db.select().from(companySettings).where(eq(companySettings.companyId, user.companyId));
    const publicUrl = settings?.preferences.publicUrl;
    if (!publicUrl?.startsWith("https://") || (c.secrets.wahaWebhookSecret?.length ?? 0) < 32) fail("Defina URL pública HTTPS e segredo de webhook com pelo menos 32 caracteres", 503);
    const create = await call("/api/sessions", { method: "POST", body: JSON.stringify({ name: p.wahaSession, start: true, config: { metadata: { detaliCompanyId: user.companyId },
      ignore: { groups: true, status: true, channels: true, broadcast: true }, webhooks: [{ url: `${publicUrl.replace(/\/$/, "")}/api/atendimento/webhook/${user.companyId}`, events: ["message.any"], hmac: { key: c.secrets.wahaWebhookSecret }, customHeaders: [{ name: "X-Detali-Webhook-Token", value: c.secrets.wahaWebhookSecret }] }] } }) });
    if (!create.ok) fail("WAHA não confirmou a criação. Verifique a sessão no serviço antes de repetir.", 502);
    r = await call(sessionPath);
  }
  if (!r.ok) fail("WAHA não confirmou a sessão. Configure o serviço ou use Iniciar conexão.", 502);
  let session = await r.json();
  if (session.config?.metadata?.detaliCompanyId !== user.companyId) fail("Sessão existente sem vínculo com esta empresa. Configure uma sessão exclusiva no WAHA.", 409);
  if (start && session.status === "STOPPED") {
    if (session.config?.metadata?.detaliCompanyId !== user.companyId) fail("Sessão existente sem vínculo com esta empresa. Configure uma sessão exclusiva no WAHA.", 409);
    const started = await call(`${sessionPath}/start`, { method: "POST", body: "{}" });
    if (!started.ok) fail("WAHA não confirmou o início da sessão", 502);
    const refreshed = await call(sessionPath); if (!refreshed.ok) fail("Não foi possível consultar a sessão", 502); session = await refreshed.json();
  }
  let qr: string | undefined;
  if (session.status === "SCAN_QR_CODE") {
    const qrResponse = await call(`/api/${encodeURIComponent(p.wahaSession)}/auth/qr?format=raw`);
    if (!qrResponse.ok) fail("QR Code indisponível. Atualize a conexão.", 502);
    const result = await qrResponse.json(); if (typeof result.value !== "string" || result.value.length > 10000) fail("WAHA retornou QR Code inválido", 502);
    const QRCode = await import("qrcode"); qr = await QRCode.toDataURL(result.value, { width: 280 });
  }
  return { provider: "waha", status: String(session.status), qr, notice: "O QR Code expira. Atualize para obter o código atual; não desconecte uma sessão ativa." };
}
