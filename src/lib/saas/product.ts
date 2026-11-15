import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { z } from "zod";
import { and, eq, desc, inArray, lt, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { productRecords, orders, customers, suppliers, memberships, checkinRecords, venueBookings, clientPortals, companyDomains, rentalDocuments, documentVisits } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { fail, uuid, audit, lockCompany } from "@/lib/erp/common";
import { assertFeature, assertLimit, assertPlan } from "./access";
import { tokenHash } from "./accounts";
import { FEATURES, type FeatureId } from "./catalog";
import { encrypt } from "@/lib/erp/crypto";
export const PRODUCT_MODULES: Record<string, FeatureId> = { eventos: "events", funil: "pipeline", checkin: "checkin", locais: "venues", treinamentos: "training", cotacoes: "quotations", suporte: "support", dominios: "domains", portal: "weekly", apps: "apps", financeiro: "advanced_finance" };
const text = z.string().trim().max(10000);
const taskSchema = z.object({ name: z.string().trim().min(1).max(300), dueDate: z.iso.date(), done: z.boolean(), clientVisible: z.boolean().default(false) });
const eventSchema = z.object({ tasks: z.array(taskSchema).max(300).default([]), responsibles: z.array(uuid).max(30).default([]), notes: text.default("") });
const pipelineSchema = z.object({ stage: z.enum(["novo", "contato", "proposta", "negociacao", "ganho", "perdido"]), notes: text.default("") });
const venueSchema = z.object({ address: text, capacity: z.number().int().positive().nullable() });
const trainingSchema = z.object({ content: z.string().trim().min(1).max(100000), assignees: z.array(uuid).max(300) });
const quotationSchema = z.object({ request: z.string().trim().min(1).max(10000), offers: z.array(z.object({ supplierId: uuid, amountCents: z.number().int().nonnegative().max(999999999), notes: text, receivedAt: z.iso.date() })).max(100), approvedSupplierId: uuid.nullable() });
const supportSchema = z.object({ message: z.string().trim().min(1).max(10000), channel: z.enum(["sistema", "email", "telefone"]), appointment: z.iso.datetime().nullable() });
async function tenantReferences(user: SessionUser, orderId?: string | null, customerId?: string | null) {
  if (orderId) { const [row] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(orders.companyId, user.companyId))); if (!row) fail("Evento não encontrado", 404); }
  if (customerId) { const [row] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.companyId, user.companyId))); if (!row) fail("Cliente não encontrado", 404); }
}
export async function productData(user: SessionUser, module: string) {
  const feature = PRODUCT_MODULES[module]; if (!feature) fail("Módulo não encontrado", 404);
  await assertFeature(user, feature);
  if (module === "checkin") return { participants: await db.select().from(checkinRecords).where(eq(checkinRecords.companyId, user.companyId)).orderBy(desc(checkinRecords.createdAt)).limit(1000) };
  if (module === "dominios") return { domains: await db.select().from(companyDomains).where(eq(companyDomains.companyId, user.companyId)), hosting: "A verificação DNS não instala o domínio ou certificado na hospedagem." };
  if (module === "portal") {
    const { integrationConfig } = await import("@/lib/erp/settings"); const config = await integrationConfig(user.companyId);
    return { portals: await db.select({ id: clientPortals.id, customerId: clientPortals.customerId, orderIds: clientPortals.orderIds, active: clientPortals.active, expiresAt: clientPortals.expiresAt }).from(clientPortals).where(eq(clientPortals.companyId, user.companyId)), weekly: { smtpConfigured: Boolean(config.config.smtpHost && config.config.mailFrom && config.secrets.smtpPassword), cronSecretConfigured: Boolean(process.env.CRON_SECRET), schedule: "Segundas-feiras no fuso da empresa. É necessário executar o agendador externo." } };
  }
  if (module === "apps") return { apps: [
    { name: "WhatsApp Meta / WAHA", feature: "attendance", path: "/atendimento/configuracoes", status: "Configurar conta ou serviço externo", extraCost: null },
    { name: "Focus NFe", feature: "invoices", path: "/notas-fiscais", status: "NF-e implementada; NFS-e pendente", extraCost: null },
    { name: "PagBank", feature: "finance", path: "/gestao/configuracoes", status: "Checkout; cobrança SaaS recorrente pendente", extraCost: null },
    { name: "ZapSign", feature: "proposals", path: "/gestao/configuracoes", status: "Configurar assinatura eletrônica", extraCost: null },
    { name: "SMTP", feature: "weekly", path: "/gestao/configuracoes", status: "Configurar envio de e-mail", extraCost: null },
    { name: "Conciliação bancária automática", feature: "advanced_finance", path: "", status: "Pendente; sem conexão bancária", extraCost: null },
  ].map(app => ({ ...app, availability: FEATURES.find(f => f.id === app.feature)?.detail })) };
  if (module === "financeiro") {
    await assertFeature(user, "finance", "financial");
    const { reportData } = await import("@/lib/erp/reports");
    const report = await reportData(user, new URLSearchParams());
    const receipts = await db.select({ id: productRecords.id, title: productRecords.title, data: productRecords.data }).from(productRecords).where(and(eq(productRecords.companyId, user.companyId), eq(productRecords.module, "comprovantes")));
    return { report: { ...report, dre: { revenuesCents: report.totals.received, expensesCents: report.totals.paid, resultCents: report.totals.net } }, receipts, warning: "Resultado gerencial pelo regime de caixa, no mês atual até hoje. Não substitui DRE contábil por competência nem confirma extratos bancários." };
  }
  let records = await db.select().from(productRecords).where(and(eq(productRecords.companyId, user.companyId), eq(productRecords.module, module))).orderBy(desc(productRecords.updatedAt)).limit(500);
  if (module === "treinamentos" && user.role !== "gestor") records = records.filter(r => (r.data.assignees as string[] | undefined)?.includes(user.id));
  if (module === "suporte" && user.role !== "gestor") records = records.filter(r => r.createdBy === user.id);
  const bookings = module === "locais" ? await db.select().from(venueBookings).where(eq(venueBookings.companyId, user.companyId)) : [];
  return { records, bookings };
}
export async function saveRecord(user: SessionUser, module: string, input: unknown) {
  const feature = PRODUCT_MODULES[module]; if (!feature || !["eventos", "funil", "locais", "treinamentos", "cotacoes", "suporte"].includes(module)) fail("Módulo sem cadastro disponível", 400);
  const body = z.object({ id: uuid.optional(), title: z.string().trim().min(2).max(300), orderId: uuid.nullable().default(null), customerId: uuid.nullable().default(null), data: z.record(z.string(), z.unknown()), archived: z.boolean().default(false) }).parse(input);
  await assertFeature(user, feature, body.archived ? "delete" : body.id ? "edit" : "create");
  await tenantReferences(user, body.orderId, body.customerId);
  let data: Record<string, unknown>;
  if (module === "eventos") {
    if (!body.orderId) fail("Vincule o planejamento a um evento/pedido", 400);
    const parsed = eventSchema.parse(body.data); await assertFeature(user, "responsibles", body.id ? "edit" : "create");
    if (parsed.responsibles.length) {
      const found = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.companyId, user.companyId), inArray(customers.id, parsed.responsibles)));
      if (found.length !== new Set(parsed.responsibles).size) fail("Responsável de outra empresa ou não encontrado", 400);
    }
    data = parsed;
  } else if (module === "funil") data = pipelineSchema.parse(body.data);
  else if (module === "locais") data = venueSchema.parse(body.data);
  else if (module === "treinamentos") {
    if (user.role !== "gestor") fail("Apenas administradores podem distribuir treinamentos", 403);
    const parsed = trainingSchema.parse(body.data);
    if (parsed.assignees.length) { const found = await db.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.companyId, user.companyId), eq(memberships.active, true), inArray(memberships.userId, parsed.assignees))); if (found.length !== new Set(parsed.assignees).size) fail("Participante de outra empresa ou sem acesso", 400); }
    data = parsed;
  } else if (module === "cotacoes") {
    const parsed = quotationSchema.parse(body.data); const ids = [...new Set(parsed.offers.map(o => o.supplierId))];
    if (ids.length) { const found = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.companyId, user.companyId), inArray(suppliers.id, ids))); if (found.length !== ids.length) fail("Fornecedor de outra empresa ou não encontrado", 400); }
    if (parsed.approvedSupplierId && !ids.includes(parsed.approvedSupplierId)) fail("Aprovação exige resposta cadastrada do fornecedor", 400);
    data = parsed;
  } else data = supportSchema.parse(body.data);
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    let old: typeof productRecords.$inferSelect | undefined;
    if (body.id) { [old] = await tx.select().from(productRecords).where(and(eq(productRecords.id, body.id), eq(productRecords.companyId, user.companyId), eq(productRecords.module, module))).for("update"); if (!old) fail("Registro não encontrado", 404); }
    if (module === "locais" && (!old || old.status === "arquivado") && !body.archived) await assertLimit(tx, user.companyId, "venues", 1);
    if (module === "suporte" && old && user.role !== "gestor" && old.createdBy !== user.id) fail("Solicitação não encontrada", 404);
    if (module === "funil") data.history = [...(old?.data.history as unknown[] ?? []), { stage: data.stage, at: new Date().toISOString(), userId: user.id }].slice(-1000);
    if (module === "treinamentos") data.completedBy = old?.data.completedBy ?? [];
    if (module === "suporte") data.replies = old?.data.replies ?? [];
    const values = { title: body.title, orderId: body.orderId, customerId: body.customerId, data, status: body.archived ? "arquivado" : "ativo", updatedAt: new Date() };
    const [record] = old ? await tx.update(productRecords).set(values).where(eq(productRecords.id, old.id)).returning() : await tx.insert(productRecords).values({ ...values, companyId: user.companyId, module, createdBy: user.id }).returning();
    await audit(tx, user, "modulo_saas_salvo", { module, id: record.id, archived: body.archived });
    return { record };
  });
}
export async function completeTraining(user: SessionUser, input: unknown) {
  await assertFeature(user, "training", "edit"); const { id } = z.object({ id: uuid }).parse(input);
  return db.transaction(async tx => {
    const [record] = await tx.select().from(productRecords).where(and(eq(productRecords.id, id), eq(productRecords.companyId, user.companyId), eq(productRecords.module, "treinamentos"))).for("update");
    if (!record || !(record.data.assignees as string[]).includes(user.id)) fail("Treinamento não atribuído a você", 403);
    const done = record.data.completedBy as { userId: string; at: string }[] ?? [];
    if (!done.some(x => x.userId === user.id)) { done.push({ userId: user.id, at: new Date().toISOString() }); await tx.update(productRecords).set({ data: { ...record.data, completedBy: done }, updatedAt: new Date() }).where(eq(productRecords.id, id)); }
    return { completed: true };
  });
}
export async function bookVenue(user: SessionUser, input: unknown) {
  await assertFeature(user, "venues", "create");
  const body = z.object({ venueId: uuid, orderId: uuid, startsAt: z.iso.datetime(), endsAt: z.iso.datetime() }).parse(input);
  if (body.endsAt <= body.startsAt) fail("Período inválido", 400); await tenantReferences(user, body.orderId);
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [venue] = await tx.select().from(productRecords).where(and(eq(productRecords.id, body.venueId), eq(productRecords.companyId, user.companyId), eq(productRecords.module, "locais"), eq(productRecords.status, "ativo"))).for("update");
    if (!venue) fail("Local não encontrado", 404);
    const startsAt = new Date(body.startsAt), endsAt = new Date(body.endsAt);
    const [conflict] = await tx.select({ id: venueBookings.id }).from(venueBookings).where(and(eq(venueBookings.venueId, body.venueId), lt(venueBookings.startsAt, endsAt), gt(venueBookings.endsAt, startsAt)));
    if (conflict) fail("Local já reservado nesse período", 409);
    const [booking] = await tx.insert(venueBookings).values({ ...body, startsAt, endsAt, companyId: user.companyId, createdBy: user.id }).returning();
    await audit(tx, user, "local_reservado", { id: booking.id }); return { booking };
  });
}
function qrToken(id: string) {
  const secret = process.env.APP_ENCRYPTION_KEY; if (!secret || secret.length < 32) fail("Configure a chave de criptografia", 503);
  return `detali-checkin:${id}:${createHmac("sha256", secret).update(`checkin:${id}`).digest("hex")}`;
}
export async function importParticipants(user: SessionUser, input: unknown) {
  await assertFeature(user, "checkin", "create");
  const body = z.object({ orderId: uuid, source: z.enum(["import", "qr"]), participants: z.array(z.object({ name: z.string().trim().min(1).max(300), externalKey: z.string().trim().min(1).max(300) })).min(1).max(1000) }).parse(input);
  await tenantReferences(user, body.orderId);
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const existing = await tx.select({ externalKey: checkinRecords.externalKey }).from(checkinRecords).where(and(eq(checkinRecords.companyId, user.companyId), eq(checkinRecords.orderId, body.orderId)));
    const keys = new Set(existing.map(x => x.externalKey)); const pending = body.participants.filter(p => { if (keys.has(p.externalKey)) return false; keys.add(p.externalKey); return true; });
    await assertLimit(tx, user.companyId, "checkins_month", pending.length);
    for (const p of pending) { const id = crypto.randomUUID(); await tx.insert(checkinRecords).values({ ...p, id, companyId: user.companyId, orderId: body.orderId, source: body.source, qrHash: tokenHash(qrToken(id)), checkedAt: body.source === "qr" ? new Date() : null, createdBy: user.id }); }
    await audit(tx, user, "participantes_processados", { orderId: body.orderId, source: body.source, count: pending.length });
    return { processed: pending.length, duplicated: body.participants.length - pending.length };
  });
}
export async function participantQr(user: SessionUser, id: string) {
  await assertFeature(user, "checkin"); uuid.parse(id);
  const [row] = await db.select({ id: checkinRecords.id }).from(checkinRecords).where(and(eq(checkinRecords.id, id), eq(checkinRecords.companyId, user.companyId)));
  if (!row) fail("Participante não encontrado", 404);
  return qrToken(id);
}
export async function scanParticipant(user: SessionUser, input: unknown) {
  await assertFeature(user, "checkin", "edit"); const { token, orderId } = z.object({ token: z.string().max(200), orderId: uuid }).parse(input);
  const match = /^detali-checkin:([a-f0-9-]{36}):([a-f0-9]{64})$/.exec(token); if (!match) fail("QR Code de participante inválido", 400);
  const expected = qrToken(match[1]); if (token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) fail("QR Code inválido", 400);
  return db.transaction(async tx => {
    const [row] = await tx.select().from(checkinRecords).where(and(eq(checkinRecords.id, match[1]), eq(checkinRecords.companyId, user.companyId), eq(checkinRecords.orderId, orderId), eq(checkinRecords.qrHash, tokenHash(token)))).for("update");
    if (!row) fail("QR Code não pertence a este evento", 404);
    if (!row.checkedAt) await tx.update(checkinRecords).set({ checkedAt: new Date() }).where(eq(checkinRecords.id, row.id));
    return { checked: true, duplicated: Boolean(row.checkedAt), name: row.name };
  });
}
export async function createPortal(user: SessionUser, input: unknown) {
  await assertFeature(user, "weekly", "create");
  const body = z.object({ customerId: uuid, orderIds: z.array(uuid).min(1).max(100), days: z.number().int().min(1).max(365).default(90) }).parse(input);
  await tenantReferences(user, null, body.customerId);
  for (const id of body.orderIds) await tenantReferences(user, id);
  const token = randomBytes(32).toString("hex");
  const portal = await db.transaction(async tx => {
    const [created] = await tx.insert(clientPortals).values({ companyId: user.companyId, customerId: body.customerId, orderIds: [...new Set(body.orderIds)], tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + body.days * 86400000), createdBy: user.id }).returning();
    await tx.insert(productRecords).values({ id: created.id, companyId: user.companyId, module: "portal-secrets", title: "Credencial criptografada da área do cliente", customerId: body.customerId, data: { encryptedToken: encrypt(token) }, createdBy: user.id });
    return created;
  });
  return { id: portal.id, path: `/area-cliente/${token}`, warning: "Este link dá acesso aos eventos selecionados. Compartilhe somente com o responsável autorizado." };
}
export async function revokePortal(user: SessionUser, input: unknown) {
  await assertFeature(user, "weekly", "edit"); const { id } = z.object({ id: uuid }).parse(input);
  const [row] = await db.update(clientPortals).set({ active: false }).where(and(eq(clientPortals.id, id), eq(clientPortals.companyId, user.companyId))).returning(); if (!row) fail("Área não encontrada", 404); return { ok: true };
}
export async function portalData(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) fail("Área não encontrada", 404);
  const [portal] = await db.select().from(clientPortals).where(and(eq(clientPortals.tokenHash, tokenHash(token)), eq(clientPortals.active, true), gt(clientPortals.expiresAt, new Date())));
  if (!portal) fail("Área expirada ou revogada", 404); await assertPlan(portal.companyId, "weekly");
  const events = await db.select({ id: orders.id, eventName: orders.eventName, eventDate: orders.eventDate, returnDueDate: orders.returnDueDate, status: orders.status }).from(orders).where(and(eq(orders.companyId, portal.companyId), inArray(orders.id, portal.orderIds)));
  const plans = await db.select({ orderId: productRecords.orderId, data: productRecords.data }).from(productRecords).where(and(eq(productRecords.companyId, portal.companyId), eq(productRecords.module, "eventos"), inArray(productRecords.orderId, portal.orderIds)));
  const documents = await db.select({ id: rentalDocuments.id, kind: rentalDocuments.kind, number: rentalDocuments.number, eventName: rentalDocuments.eventName, totalCents: rentalDocuments.totalCents, status: rentalDocuments.status }).from(rentalDocuments)
    .where(and(eq(rentalDocuments.companyId, portal.companyId), eq(rentalDocuments.customerId, portal.customerId), inArray(rentalDocuments.orderId, portal.orderIds)));
  return { events, documents, tasks: plans.flatMap(p => (p.data.tasks as z.infer<typeof taskSchema>[] ?? []).filter(t => t.clientVisible).map(t => ({ ...t, orderId: p.orderId }))) };
}
export async function registerDomain(user: SessionUser, input: unknown) {
  await assertFeature(user, "domains", "create");
  const { hostname } = z.object({ hostname: z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/) }).parse(input);
  const [domain] = await db.insert(companyDomains).values({ companyId: user.companyId, hostname, verification: `detali-verification=${randomBytes(24).toString("hex")}` }).onConflictDoNothing().returning();
  if (!domain) fail("Domínio já cadastrado. Contate a Detali se precisar transferir o vínculo.", 409);
  return { domain, txtName: `_detali.${hostname}` };
}
export async function verifyDomain(user: SessionUser, input: unknown) {
  await assertFeature(user, "domains", "edit"); const { id } = z.object({ id: uuid }).parse(input);
  const [domain] = await db.select().from(companyDomains).where(and(eq(companyDomains.id, id), eq(companyDomains.companyId, user.companyId)));
  if (!domain) fail("Domínio não encontrado", 404);
  let records: string[][]; try { records = await resolveTxt(`_detali.${domain.hostname}`); } catch { fail("Registro TXT ainda não encontrado no DNS", 409); }
  if (!records.some(r => r.join("") === domain.verification)) fail("Registro TXT não corresponde à verificação", 409);
  await db.update(companyDomains).set({ verifiedAt: new Date() }).where(eq(companyDomains.id, id));
  return { verified: true, hosting: "Propriedade verificada. Ainda é necessário vincular o domínio e TLS na hospedagem." };
}
export async function recordDocumentVisit(token: string, visitor: string, agent: string, purpose: string) {
  if (/bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|headless/i.test(agent) || /prefetch|preview/i.test(purpose)) return { recorded: false };
  const { sharedDocument } = await import("@/lib/erp/store"); const doc = await sharedDocument(token);
  const bucket = Math.floor(Date.now() / (30 * 60000));
  const visitKey = tokenHash(`${visitor}:${bucket}`);
  const result = await db.insert(documentVisits).values({ companyId: doc.companyId, documentId: doc.id, visitKey }).onConflictDoNothing().returning();
  return { recorded: Boolean(result.length) };
}
