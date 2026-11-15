import { assertFeature, assertPlan } from "@/lib/saas/access";
import { z } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { rentalDocuments, customers, financialEntries, settlements, paymentCheckouts, messageLog, companies } from "@/lib/db/schema";
import { and, eq, sql, desc, inArray } from "drizzle-orm";
import { AuthError, type SessionUser } from "@/lib/auth/session";
import { uuid, fail, lockCompany, audit } from "./common";
import { integrationConfig } from "./settings";
import { rentalPdf, receiptPdf } from "./pdf";
import { recordSettlement } from "./finance";
import { shareDocument } from "./commercial";
import { sharedDocument } from "./store";

const providerTimeout = () => AbortSignal.timeout(25000);
class ProviderError extends AuthError {
  definitive: boolean;
  constructor(providerStatus: number) {
    super(`O provedor recusou a operação (HTTP ${providerStatus}). Verifique a configuração e o cadastro.`, 502);
    this.definitive = [400, 401, 403, 404, 405, 413, 415, 422].includes(providerStatus);
  }
}
async function providerJson(response: Response) {
  if (!response.ok) throw new ProviderError(response.status);
  return response.json() as Promise<unknown>;
}
function publicUrl(value?: string) {
  if (!value || !value.startsWith("https://")) fail("Configure a URL pública HTTPS da locadora", 503);
  return value.replace(/\/$/, "");
}
export function smtpTransport(config: Awaited<ReturnType<typeof integrationConfig>>) {
  const { config: c, secrets } = config;
  if (!c.smtpHost || !c.smtpPort || !c.smtpUser || !c.mailFrom || !secrets.smtpPassword) fail("E-mail aguardando configuração SMTP", 503);
  return nodemailer.createTransport({ host: c.smtpHost, port: c.smtpPort, secure: c.smtpSecure ?? c.smtpPort === 465,
    requireTLS: !(c.smtpSecure ?? c.smtpPort === 465), auth: { user: c.smtpUser, pass: secrets.smtpPassword },
    connectionTimeout: 15000, socketTimeout: 25000 });
}
export async function testSmtp(user: SessionUser) {
  const config = await integrationConfig(user.companyId);
  await smtpTransport(config).verify();
  return { ok: true, message: "Conexão e autenticação SMTP verificadas. A entrega depende da aceitação do destinatário." };
}
const sendSchema = z.object({ id: uuid, channel: z.enum(["email", "whatsapp"]), requestKey: z.string().min(16).max(120), receipt: z.boolean().default(false) });
export async function sendDocument(user: SessionUser, input: unknown) {
  await assertFeature(user, input && typeof input === "object" && "receipt" in input && input.receipt ? "finance" : "proposals", "edit");
  const data = sendSchema.parse(input);
  const cfg = await integrationConfig(user.companyId);
  if (data.receipt && data.channel !== "email") fail("O envio de recibos utiliza e-mail");
  let recipient: string, subject: string, buffer: Buffer, fileName: string, documentId: string | undefined;
  if (data.receipt) {
    const pdf = await receiptPdf(user, data.id);
    const [entry] = await db.select().from(financialEntries).where(eq(financialEntries.id, pdf.settlement.entryId));
    const [customer] = entry.customerId ? await db.select().from(customers).where(eq(customers.id, entry.customerId)) : [];
    if (!customer?.email) fail("Informe o e-mail do cliente para enviar o recibo");
    recipient = customer.email; subject = `Recibo ${pdf.settlement.receiptNumber}`; buffer = pdf.buffer; fileName = "recibo.pdf";
  } else {
    const pdf = await rentalPdf(user.companyId, data.id);
    const [customer] = await db.select().from(customers).where(eq(customers.id, pdf.document.customerId));
    recipient = data.channel === "email" ? customer.email : customer.phone.replace(/\D/g, "");
    if (!recipient) fail(`Informe ${data.channel === "email" ? "o e-mail" : "o telefone"} do cliente`);
    subject = `${pdf.document.kind === "contrato" ? "Contrato" : "Orçamento"} #${pdf.document.number}`;
    buffer = pdf.buffer; fileName = `${pdf.document.kind}-${pdf.document.number}.pdf`; documentId = pdf.document.id;
  }
  if (data.channel === "email") smtpTransport(cfg); // Validate before creating a pending send.
  else if (!cfg.secrets.whatsappToken || !cfg.config.whatsappPhoneId || !cfg.config.whatsappVersion || !cfg.config.whatsappTemplate) fail("WhatsApp aguardando configuração do número, token, versão e template aprovado", 503);
  const [existing] = await db.select().from(messageLog).where(and(eq(messageLog.companyId, user.companyId), eq(messageLog.requestKey, data.requestKey)));
  if (existing) {
    if (existing.channel !== data.channel || existing.subject !== subject || existing.recipient !== recipient || existing.documentId !== documentId && !data.receipt) fail("Chave de envio reutilizada com outros dados");
    if (existing.status === "enviado") return { message: existing, duplicated: true };
    fail("Este envio já foi iniciado. Confira o histórico antes de tentar novamente", 409);
  }
  const [log] = await db.insert(messageLog).values({ companyId: user.companyId, channel: data.channel, recipient,
    subject, status: "processando", documentId, requestKey: data.requestKey, createdBy: user.id }).returning();
  try {
    let providerId: string;
    if (data.channel === "email") {
      const result = await smtpTransport(cfg).sendMail({ from: cfg.config.mailFrom, to: recipient, subject,
        text: `Olá,\n\nSegue em anexo: ${subject}.\n\n${user.companyName}`,
        attachments: [{ filename: fileName, content: buffer, contentType: "application/pdf" }], disableFileAccess: true, disableUrlAccess: true });
      if (!result.accepted.length || result.rejected.length) fail("O servidor de e-mail não aceitou o destinatário", 502);
      providerId = result.messageId;
    } else {
      const shared = await shareDocument(user, { id: documentId });
      const link = publicUrl(cfg.settings?.preferences.publicUrl) + shared.path;
      if (recipient.length === 10 || recipient.length === 11) recipient = `55${recipient}`;
      const response = await fetch(`https://graph.facebook.com/${cfg.config.whatsappVersion}/${cfg.config.whatsappPhoneId}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${cfg.secrets.whatsappToken}`, "Content-Type": "application/json" }, signal: providerTimeout(),
        body: JSON.stringify({ messaging_product: "whatsapp", to: recipient, type: "template",
          template: { name: cfg.config.whatsappTemplate, language: { code: cfg.config.whatsappLanguage || "pt_BR" },
            components: [{ type: "body", parameters: [{ type: "text", text: link }] }] } }),
      });
      const result = z.object({ messages: z.array(z.object({ id: z.string() })).min(1) }).parse(await providerJson(response));
      providerId = result.messages[0].id;
    }
    const [message] = await db.update(messageLog).set({ status: "enviado", providerId }).where(eq(messageLog.id, log.id)).returning();
    return { message, duplicated: false };
  } catch (error) {
    await db.update(messageLog).set({ status: "incerto", error: "Envio não confirmado. Confira o provedor antes de repetir." }).where(eq(messageLog.id, log.id));
    throw error;
  }
}

export async function createCheckout(user: SessionUser, input: unknown, publicToken?: string) {
  const { entryId } = z.object({ entryId: uuid }).parse(input);
  if (publicToken) {
    const doc = await sharedDocument(publicToken);
    if (doc.companyId !== user.companyId || !doc.installments.some(p => p.id === entryId && p.balanceCents > 0)) fail("Parcela não autorizada por este documento", 403);
    await assertPlan(doc.companyId, "finance", "financial");
  } else await assertFeature(user, "finance", "financial");
  const cfg = await integrationConfig(user.companyId);
  if (!cfg.secrets.pagbankToken) fail("PagBank aguardando configuração do token", 503);
  const base = publicUrl(cfg.settings?.preferences.publicUrl);
  const prepared = await db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [entry] = await tx.select().from(financialEntries).where(and(eq(financialEntries.id, entryId), eq(financialEntries.companyId, user.companyId))).for("update");
    if (!entry || entry.direction !== "receber" || entry.cancelledAt) fail("Parcela não disponível para pagamento", 404);
    const [{ paid }] = await tx.select({ paid: sql<number>`coalesce(sum(${settlements.amountCents}),0)::float8` }).from(settlements).where(eq(settlements.entryId, entry.id));
    const amount = entry.amountCents - entry.creditedCents - paid;
    if (amount <= 0) fail("Esta parcela já está quitada");
    const [prior] = await tx.select().from(paymentCheckouts).where(and(eq(paymentCheckouts.entryId, entry.id), inArray(paymentCheckouts.status, ["ativo", "criando", "incerto"]))).orderBy(desc(paymentCheckouts.createdAt)).limit(1);
    if (prior && ["criando", "incerto"].includes(prior.status)) fail("O checkout anterior está em processamento ou precisa de conferência no PagBank", 409);
    if (prior?.status === "ativo") {
      if (prior.amountCents !== amount) fail("Já existe uma cobrança ativa com outro valor. Confira o cancelamento ou a expiração no PagBank antes de emitir outra.", 409);
      return { checkout: prior, entry, existing: true };
    }
    const [checkout] = await tx.insert(paymentCheckouts).values({ companyId: user.companyId, entryId: entry.id,
      amountCents: amount, createdBy: user.id }).returning();
    return { checkout, entry, existing: false };
  });
  if (prepared.existing) return { checkout: prepared.checkout };
  const hook = `${base}/api/pagbank/${prepared.checkout.id}`;
  if (hook.length > 100) {
    await db.update(paymentCheckouts).set({ status: "falha", error: "URL pública excede o limite do callback do provedor" }).where(eq(paymentCheckouts.id, prepared.checkout.id));
    fail("A URL pública configurada é longa demais para o callback PagBank");
  }
  try {
    const environment = cfg.config.pagbankEnvironment === "production" ? "https://api.pagseguro.com" : "https://sandbox.api.pagseguro.com";
    const response = await fetch(`${environment}/checkouts`, { method: "POST", signal: providerTimeout(),
      headers: { Authorization: `Bearer ${cfg.secrets.pagbankToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reference_id: prepared.checkout.id, customer_modifiable: true,
        items: [{ reference_id: prepared.entry.id, name: prepared.entry.description.slice(0, 100), quantity: 1, unit_amount: prepared.checkout.amountCents }],
        payment_notification_urls: [hook], notification_urls: [hook], redirect_url: `${base}/pagamento`, return_url: `${base}/pagamento` }),
    });
    const result = z.object({ id: z.string().startsWith("CHEC_"), links: z.array(z.object({ rel: z.string(), href: z.url() })) }).parse(await providerJson(response));
    const url = result.links.find(l => l.rel === "PAY")?.href;
    if (!url?.startsWith("https://")) fail("O provedor não retornou uma URL segura de pagamento", 502);
    const [checkout] = await db.update(paymentCheckouts).set({ providerId: result.id, url, status: "ativo" }).where(eq(paymentCheckouts.id, prepared.checkout.id)).returning();
    return { checkout };
  } catch (error) {
    await db.update(paymentCheckouts).set({ status: error instanceof ProviderError && error.definitive ? "falha" : "incerto", error: error instanceof Error ? error.message.slice(0, 500) : "Falha no provedor" }).where(eq(paymentCheckouts.id, prepared.checkout.id));
    throw error;
  }
}

export function authenticPagbankPayload(token: string, raw: string, signature: string) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHash("sha256").update(`${token}-${raw}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
export async function pagbankWebhook(id: string, raw: string, signature: string) {
  uuid.parse(id);
  const [checkout] = await db.select().from(paymentCheckouts).where(eq(paymentCheckouts.id, id));
  if (!checkout) fail("Checkout não encontrado", 404);
  const cfg = await integrationConfig(checkout.companyId);
  if (!cfg.secrets.pagbankToken || !authenticPagbankPayload(cfg.secrets.pagbankToken, raw, signature)) fail("Notificação não autenticada", 401);
  const payload = z.object({ reference_id: z.string(), status: z.string().optional(), charges: z.array(z.object({
    id: z.string(), status: z.string(), paid_at: z.string().optional(), amount: z.object({ value: z.number().int(), currency: z.string() }),
  })).optional() }).parse(JSON.parse(raw));
  if (payload.reference_id !== checkout.id) fail("Referência da notificação não corresponde ao checkout");
  const paid = payload.charges?.filter(c => c.status === "PAID") ?? [];
  if (!paid.length) {
    if (payload.status === "EXPIRED") await db.update(paymentCheckouts).set({ status: "expirado" }).where(eq(paymentCheckouts.id, checkout.id));
    return { ok: true, confirmed: false };
  }
  if (paid.length !== 1 || paid[0].amount.currency !== "BRL" || paid[0].amount.value !== checkout.amountCents) fail("Valor ou moeda de pagamento divergente", 409);
  const [company] = await db.select().from(companies).where(eq(companies.id, checkout.companyId));
  const actor: SessionUser = { id: checkout.createdBy, companyId: checkout.companyId, companyName: company.name,
    email: "", name: "PagBank", role: "gestor", timezone: company.timezone };
  const result = await db.transaction(async tx => {
    const result = await recordSettlement(tx, actor, { entryId: checkout.entryId, amountCents: paid[0].amount.value,
      method: "pagbank", occurredAt: paid[0].paid_at ? new Date(paid[0].paid_at).toISOString() : undefined,
      note: "Confirmado por notificação autenticada PagBank", idempotencyKey: `pagbank:${paid[0].id}` }, paid[0].id);
    await tx.update(paymentCheckouts).set({ status: "pago" }).where(eq(paymentCheckouts.id, checkout.id));
    return result;
  });
  return { ok: true, confirmed: true, duplicated: result.duplicated };
}

const signatureResult = z.object({ token: z.string(), status: z.string(), external_id: z.string().optional(),
  signed_file: z.string().nullable().optional(), signers: z.array(z.object({ sign_url: z.string().optional(), status: z.string(), signed_at: z.string().nullable().optional() })) });
export async function requestSignature(user: SessionUser, input: unknown) {
  await assertFeature(user, "proposals", "edit");
  const { id } = z.object({ id: uuid }).parse(input);
  const cfg = await integrationConfig(user.companyId);
  if (!cfg.secrets.zapsignToken) fail("Assinatura aguardando configuração do token ZapSign", 503);
  const pdf = await rentalPdf(user.companyId, id);
  if (pdf.document.kind !== "contrato" || pdf.document.status === "cancelado") fail("Somente contratos ativos podem ser enviados para assinatura");
  if (pdf.document.signature?.token) return { signature: pdf.document.signature };
  if (["processando", "incerto"].includes(pdf.document.signature?.status ?? "")) fail("Confira a solicitação anterior no provedor antes de reenviar", 409);
  const [customer] = await db.select().from(customers).where(eq(customers.id, pdf.document.customerId));
  if (!customer.email) fail("Informe o e-mail do cliente antes de solicitar assinatura");
  const hash = createHash("sha256").update(pdf.buffer).digest("hex");
  await db.transaction(async tx => {
    const [locked] = await tx.select().from(rentalDocuments).where(eq(rentalDocuments.id, id)).for("update");
    if (locked.signature?.token || ["processando", "incerto"].includes(locked.signature?.status ?? "")) fail("Solicitação de assinatura já iniciada", 409);
    await tx.update(rentalDocuments).set({ signature: { provider: "zapsign", status: "processando", documentHash: hash } }).where(eq(rentalDocuments.id, id));
  });
  try {
    const response = await fetch("https://api.zapsign.com.br/api/v1/docs/", { method: "POST", signal: providerTimeout(),
      headers: { Authorization: `Bearer ${cfg.secrets.zapsignToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Contrato #${pdf.document.number}`, base64_pdf: pdf.buffer.toString("base64"), external_id: id,
        sandbox: cfg.config.signatureEnvironment !== "production", lang: "pt-br", disable_signer_emails: true,
        signers: [{ name: customer.name, email: customer.email, auth_mode: cfg.config.signatureAuthMode ?? "certificadoDigital",
          require_cpf: true, lock_name: true, lock_email: true, send_automatic_email: false }] }),
    });
    const result = signatureResult.parse(await providerJson(response));
    const signature = { provider: "zapsign" as const, token: result.token, status: result.status, signUrl: result.signers[0]?.sign_url, documentHash: hash };
    await db.update(rentalDocuments).set({ signature }).where(eq(rentalDocuments.id, id));
    return { signature };
  } catch (error) {
    await db.update(rentalDocuments).set({ signature: { provider: "zapsign", status: error instanceof ProviderError && error.definitive ? "falha" : "incerto", documentHash: hash } }).where(eq(rentalDocuments.id, id));
    throw error;
  }
}
export async function syncSignature(user: SessionUser, input: unknown, publicToken?: string) {
  const { id } = z.object({ id: uuid }).parse(input);
  if (publicToken) {
    const document = await sharedDocument(publicToken);
    if (document.id !== id || document.companyId !== user.companyId) fail("Documento não autorizado por este link", 403);
    await assertPlan(document.companyId, "proposals");
  } else await assertFeature(user, "proposals", "view");
  const cfg = await integrationConfig(user.companyId);
  if (!cfg.secrets.zapsignToken) fail("Assinatura aguardando configuração", 503);
  const [doc] = await db.select().from(rentalDocuments).where(and(eq(rentalDocuments.id, id), eq(rentalDocuments.companyId, user.companyId)));
  if (!doc?.signature?.token) fail("O contrato ainda não foi enviado ao provedor");
  const response = await fetch(`https://api.zapsign.com.br/api/v1/docs/${encodeURIComponent(doc.signature.token)}/`, {
    headers: { Authorization: `Bearer ${cfg.secrets.zapsignToken}` }, signal: providerTimeout(), cache: "no-store" });
  const result = signatureResult.parse(await providerJson(response));
  if (result.token !== doc.signature.token || result.external_id && result.external_id !== id) fail("O documento retornado não corresponde ao contrato", 502);
  const signature = { ...doc.signature, status: result.status, signedFileUrl: result.signed_file ?? undefined };
  if (signature.signedFileUrl && !signature.signedFileUrl.startsWith("https://")) fail("Arquivo assinado sem URL segura", 502);
  if (result.status === "signed" && !result.signed_file) fail("O provedor ainda não disponibilizou o arquivo assinado", 502);
  await db.transaction(async tx => {
    await tx.update(rentalDocuments).set({ signature,
      signedAt: result.status === "signed" ? doc.signedAt ?? new Date() : doc.signedAt }).where(eq(rentalDocuments.id, id));
    await audit(tx, user, "assinatura_consultada", { documentId: id, providerStatus: result.status });
  });
  return { signature };
}
