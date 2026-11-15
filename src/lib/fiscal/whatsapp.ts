import { z } from "zod";
import { and, eq, sql, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { fiscalDeliveries, aiMessages, aiThreads, aiDeliveries } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { audit, fail, lockCompany, uuid } from "@/lib/erp/common";
import { aiConfig, wahaBase } from "@/lib/assistant/config";
import { fiscalAccess, fiscalConfig } from "./config";
import { invoiceFile, findInvoice } from "./invoices";
import { boundedBytes } from "./provider";

export function fiscalPhone(raw: string) {
  let phone = raw.replace(/\D/g, ""); if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
  if (!/^[1-9]\d{9,14}$/.test(phone)) fail("Complete o telefone do destinatário com DDI e DDD no rascunho"); return phone;
}
class MessageFailure extends Error { constructor(public definitive: boolean) { super("O WhatsApp não confirmou o envio"); } }
async function whatsappJson(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new MessageFailure([400,401,403,404,405,413,415,422,429].includes(response.status));
  const data = JSON.parse((await boundedBytes(response, 1024 * 1024)).toString("utf8")); return data as Record<string, unknown>;
}
export async function sendFiscalWhatsApp(user: SessionUser, input: unknown) {
  user = await fiscalAccess(user);
  const data = z.object({ id: uuid, requestKey: z.string().min(16).max(120), consent: z.literal(true) }).strict().parse(input);
  const row = await findInvoice(user, data.id), phone = fiscalPhone(row.snapshot.draft.recipient.phone);
  const [previous] = await db.select().from(fiscalDeliveries).where(and(eq(fiscalDeliveries.companyId, user.companyId), eq(fiscalDeliveries.requestKey, data.requestKey)));
  if (previous) { if (previous.invoiceId !== row.id || previous.recipient !== phone) fail("Chave de envio já usada para outro documento", 409); return { delivery: previous, duplicate: true }; }
  const c = await aiConfig(user.companyId), p = c.preferences, fiscal = await fiscalConfig(user.companyId);
  const provider = p.whatsappProvider ?? "meta";
  if (provider === "meta" && (!p.phoneId || !p.graphVersion || !c.secrets.metaToken)) fail("Configure o WhatsApp em Atendimento e agentes → Configurações", 503);
  if (provider === "waha" && (!p.wahaSession || !c.secrets.wahaKey)) fail("Configure a conexão WAHA em Atendimento e agentes", 503);
  const base = provider === "waha" ? wahaBase(p.wahaUrl) : `https://graph.facebook.com/${p.graphVersion}/${p.phoneId}`;
  const [thread] = await db.select().from(aiThreads).where(and(eq(aiThreads.companyId, user.companyId), eq(aiThreads.channel, "whatsapp"), eq(aiThreads.externalKey, `${provider}:${phone}`)));
  const [optOut] = await db.select({ id: aiThreads.id }).from(aiThreads).where(and(eq(aiThreads.companyId, user.companyId), eq(aiThreads.channel, "whatsapp"), eq(aiThreads.phone, phone), eq(aiThreads.optedOut, true))).limit(1);
  if (optOut) fail("Este contato pediu para não receber mensagens", 409);
  const template = fiscal.preferences.whatsappTemplate;
  if (provider === "meta" && !template && (!thread?.lastInboundAt || Date.now() - thread.lastInboundAt.getTime() >= 24 * 3600000)) fail("Fora da janela de 24 horas. Configure um template aprovado pela Meta com cabeçalho de documento PDF.", 409);
  const file = await invoiceFile(user, row.id, "pdf");
  const prepared = await db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [old] = await tx.select().from(fiscalDeliveries).where(and(eq(fiscalDeliveries.companyId, user.companyId), eq(fiscalDeliveries.requestKey, data.requestKey)));
    if (old) return { delivery: old, threadId: "", messageId: "", claimed: false };
    const [uncertain] = await tx.select({ id: fiscalDeliveries.id }).from(fiscalDeliveries).where(and(eq(fiscalDeliveries.companyId, user.companyId), eq(fiscalDeliveries.invoiceId, row.id), eq(fiscalDeliveries.recipient, phone), inArray(fiscalDeliveries.status, ["enviando", "incerto"])));
    if (uncertain) fail("Há um envio em andamento ou incerto desta nota. Confira no provedor antes de tentar outro envio.", 409);
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(aiMessages).where(and(eq(aiMessages.companyId, user.companyId), inArray(aiMessages.status, ["enviando", "aceita", "entregue", "lida", "incerto"]), sql`${aiMessages.createdAt} >= date_trunc('day', now())`));
    if (count.n >= (p.dailyMessages ?? 100)) fail("Limite diário de mensagens atingido", 429);
    const [recent] = await tx.select({ id: aiMessages.id }).from(aiMessages).where(and(eq(aiMessages.companyId, user.companyId), inArray(aiMessages.status, ["enviando", "aceita", "incerto"]), sql`${aiMessages.createdAt} > now() - interval '6 seconds'`)).limit(1);
    if (recent) fail("Aguarde alguns segundos antes do próximo envio", 429);
    await tx.insert(aiThreads).values({ companyId: user.companyId, channel: "whatsapp", externalKey: `${provider}:${phone}`, phone, name: row.snapshot.draft.recipient.name, status: "humano" }).onConflictDoNothing();
    const [current] = await tx.select().from(aiThreads).where(and(eq(aiThreads.companyId, user.companyId), eq(aiThreads.channel, "whatsapp"), eq(aiThreads.externalKey, `${provider}:${phone}`)));
    const [blocked] = await tx.select({ id: aiThreads.id }).from(aiThreads).where(and(eq(aiThreads.companyId, user.companyId), eq(aiThreads.channel, "whatsapp"), eq(aiThreads.phone, phone), eq(aiThreads.optedOut, true))).limit(1);
    if (blocked) fail("Este contato pediu para não receber mensagens", 409);
    const [delivery] = await tx.insert(fiscalDeliveries).values({ companyId: user.companyId, invoiceId: row.id, requestKey: data.requestKey, recipient: phone, status: "enviando", createdBy: user.id }).returning();
    const [message] = await tx.insert(aiMessages).values({ companyId: user.companyId, threadId: current.id, role: "humano", content: `[PDF] ${file.filename}${row.environment === "homologacao" ? " — TESTE SEM VALOR FISCAL" : ""}`, status: "enviando", requestKey: `fiscal:${data.requestKey}`, metadata: { fiscalInvoiceId: row.id, fiscalDeliveryId: delivery.id, filename: file.filename } }).returning();
    await audit(tx, user, "nfe_whatsapp_solicitado", { id: row.id, deliveryId: delivery.id, recipient: phone });
    return { delivery, threadId: current.id, messageId: message.id, claimed: true };
  });
  if (!prepared.claimed) return { delivery: prepared.delivery, duplicate: true };
  let sending = false;
  try {
    let result: Record<string, unknown>;
    if (provider === "meta") {
      const form = new FormData(); form.set("messaging_product", "whatsapp"); form.set("type", "application/pdf"); form.set("file", new Blob([new Uint8Array(file.buffer)], { type: "application/pdf" }), file.filename);
      const media = await whatsappJson(`${base}/media`, { method: "POST", headers: { Authorization: `Bearer ${c.secrets.metaToken}` }, body: form });
      if (typeof media.id !== "string" || !media.id) throw new MessageFailure(true);
      const values: Record<string, string> = { numero: row.number ?? "", cliente: row.snapshot.draft.recipient.name, empresa: row.snapshot.emitter.name };
      const parameters = fiscal.preferences.whatsappBodyParameters.map(value => {
        if (/^\{\{.+\}\}$/.test(value)) { const key = value.slice(2, -2); if (!(key in values)) fail("Variável do template WhatsApp desconhecida"); return values[key]; } return value;
      });
      const components = [{ type: "header", parameters: [{ type: "document", document: { id: media.id, filename: file.filename } }] }, ...(parameters.length ? [{ type: "body", parameters: parameters.map(text => ({ type: "text", text })) }] : [])];
      sending = true;
      result = await whatsappJson(`${base}/messages`, { method: "POST", headers: { Authorization: `Bearer ${c.secrets.metaToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: phone,
        ...(template ? { type: "template", template: { name: template, language: { code: fiscal.preferences.whatsappLanguage }, components } } : { type: "document", document: { id: media.id, filename: file.filename, caption: row.environment === "homologacao" ? "TESTE — NF-e sem valor fiscal" : `NF-e ${row.number}` } }) }) });
    } else {
      const headers = { "X-Api-Key": c.secrets.wahaKey!, "Content-Type": "application/json" };
      const session = await whatsappJson(`${base}/api/sessions/${encodeURIComponent(p.wahaSession!)}`, { headers });
      const config = session.config as { metadata?: { detaliCompanyId?: string } } | undefined;
      if (session.status !== "WORKING" || config?.metadata?.detaliCompanyId !== user.companyId) fail("A sessão WAHA precisa estar conectada e vinculada a esta empresa", 409);
      const contact = await whatsappJson(`${base}/api/contacts/check-exists?phone=${encodeURIComponent(phone)}&session=${encodeURIComponent(p.wahaSession!)}`, { headers });
      if (contact.numberExists !== true || typeof contact.chatId !== "string" || !/^\d+@(c\.us|lid)$/.test(contact.chatId)) fail("WAHA não confirmou o número do destinatário", 409);
      sending = true;
      result = await whatsappJson(`${base}/api/sendFile`, { method: "POST", headers, body: JSON.stringify({ session: p.wahaSession, chatId: contact.chatId, file: { mimetype: "application/pdf", filename: file.filename, data: file.buffer.toString("base64") }, caption: row.environment === "homologacao" ? "TESTE — NF-e sem valor fiscal" : `NF-e ${row.number}` }) });
    }
    const id = provider === "meta" ? (result.messages as { id?: string }[] | undefined)?.[0]?.id : typeof result.id === "string" ? result.id : (result.id as { _serialized?: string } | undefined)?._serialized;
    if (!id || typeof id !== "string") throw new MessageFailure(false);
    const delivery = await db.transaction(async tx => {
      await lockCompany(tx, user.companyId);
      const externalId = `${provider}:${id}`;
      const [receipt] = await tx.select().from(aiDeliveries).where(and(eq(aiDeliveries.companyId, user.companyId), eq(aiDeliveries.externalId, externalId)));
      const status = receipt?.status ?? "aceita";
      await tx.update(aiMessages).set({ status, externalId }).where(eq(aiMessages.id, prepared.messageId));
      const [updated] = await tx.update(fiscalDeliveries).set({ status, providerId: externalId }).where(eq(fiscalDeliveries.id, prepared.delivery.id)).returning();
      await audit(tx, user, "nfe_whatsapp_aceito", { id: row.id, deliveryId: updated.id, providerId: externalId }); return updated;
    });
    return { delivery };
  } catch (error) {
    const status = !sending || error instanceof MessageFailure && error.definitive ? "falhou" : "incerto";
    const message = status === "incerto" ? "Envio incerto. Confira no WhatsApp/provedor antes de repetir." : "Envio não realizado ou recusado pelo provedor. Confira a conexão, o template e o destinatário.";
    await db.transaction(async tx => {
      await tx.update(fiscalDeliveries).set({ status, error: message }).where(eq(fiscalDeliveries.id, prepared.delivery.id));
      await tx.update(aiMessages).set({ status, error: message }).where(eq(aiMessages.id, prepared.messageId));
    });
    fail(message, 502);
  }
}
