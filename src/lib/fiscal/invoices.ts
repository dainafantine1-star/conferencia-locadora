import { assertFeature } from "@/lib/saas/access";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, desc, sql, getTableColumns } from "drizzle-orm";
import { db } from "@/lib/db";
import { fiscalInvoices, fiscalSettings, fiscalDeliveries, customers, catalogItems, orders } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { audit, fail, lockCompany, uuid } from "@/lib/erp/common";
import { fiscalAccess, fiscalConfig, fiscalToken, emitterReady } from "./config";
import { draftSchema, buildPayload, productsCents, sameFiscal } from "./validation";
import { focusRequest, fiscalResult, FiscalProviderError, focusFile } from "./provider";
import type { FiscalSnapshot, FiscalPreferences, FiscalDraft } from "./types";

export type InvoiceRow = typeof fiscalInvoices.$inferSelect;
export function invoiceView(row: Omit<InvoiceRow, "pdfData" | "xmlData"> & Partial<Pick<InvoiceRow, "pdfData" | "xmlData">> & { pdfAvailable?: boolean; xmlAvailable?: boolean }) {
  const { pdfData, xmlData, pdfPath, xmlPath, pdfSha256: _pdfHash, xmlSha256: _xmlHash, payload: _payload, ...view } = row;
  void _pdfHash; void _xmlHash; void _payload;
  return { ...view, pdfAvailable: row.pdfAvailable ?? !!(pdfData || pdfPath), xmlAvailable: row.xmlAvailable ?? !!(xmlData || xmlPath) };
}
const { pdfData: _pdfColumn, xmlData: _xmlColumn, ...listColumns } = getTableColumns(fiscalInvoices);
void _pdfColumn; void _xmlColumn;
function taxSnapshot(preferences: FiscalPreferences, draft: FiscalDraft) {
  const ids = new Set(draft.items.map(i => i.catalogItemId));
  return Object.fromEntries(preferences.products.filter(p => ids.has(p.catalogItemId)).map(p => [p.catalogItemId, p.taxes]));
}
export async function findInvoice(user: SessionUser, id: string) {
  uuid.parse(id); const [row] = await db.select().from(fiscalInvoices).where(and(eq(fiscalInvoices.id, id), eq(fiscalInvoices.companyId, user.companyId)));
  if (!row) fail("NF-e não encontrada", 404); return row;
}
export async function fiscalData(user: SessionUser, query: URLSearchParams) {
  user = await fiscalAccess(user);
  const c = await fiscalConfig(user.companyId);
  const page = z.coerce.number().int().min(1).max(100000).parse(query.get("page") ?? 1);
  const where = and(eq(fiscalInvoices.companyId, user.companyId), query.has("customer") ? eq(fiscalInvoices.customerId, uuid.parse(query.get("customer"))) : undefined);
  const [rows, [count], clients, products, jobs, deliveries] = await Promise.all([
    db.select({ ...listColumns, pdfAvailable: sql<boolean>`${fiscalInvoices.pdfPath} is not null or ${fiscalInvoices.pdfData} is not null`, xmlAvailable: sql<boolean>`${fiscalInvoices.xmlPath} is not null or ${fiscalInvoices.xmlData} is not null` }).from(fiscalInvoices).where(where).orderBy(desc(fiscalInvoices.createdAt), desc(fiscalInvoices.id)).limit(25).offset((page - 1) * 25),
    db.select({ n: sql<number>`count(*)::int` }).from(fiscalInvoices).where(where),
    db.select().from(customers).where(and(eq(customers.companyId, user.companyId), eq(customers.active, true))).orderBy(customers.name),
    db.select({ id: catalogItems.id, name: catalogItems.name, unit: catalogItems.unit }).from(catalogItems).where(and(eq(catalogItems.companyId, user.companyId), eq(catalogItems.active, true))).orderBy(catalogItems.name),
    db.select({ id: orders.id, number: orders.number, eventName: orders.eventName, customerId: orders.customerId }).from(orders).where(eq(orders.companyId, user.companyId)).orderBy(desc(orders.createdAt)),
    db.select().from(fiscalDeliveries).where(eq(fiscalDeliveries.companyId, user.companyId)).orderBy(desc(fiscalDeliveries.createdAt)).limit(100),
  ]);
  return { invoices: rows.map(invoiceView), page, total: count.n, customers: clients, products, orders: jobs, deliveries,
    role: user.role, environment: c.preferences.environment, emitter: c.preferences.emitter,
    profiles: c.preferences.profiles.filter(p => p.active && p.reviewed), productRules: c.preferences.products,
    readiness: { emitter: emitterReady(c.preferences), token: !!c.secrets[c.preferences.environment], productionEnabled: c.preferences.productionEnabled },
  };
}
export async function invoiceDetail(user: SessionUser, id: string) {
  await fiscalAccess(user); const invoice = await findInvoice(user, id);
  const deliveries = await db.select().from(fiscalDeliveries).where(and(eq(fiscalDeliveries.companyId, user.companyId), eq(fiscalDeliveries.invoiceId, invoice.id))).orderBy(desc(fiscalDeliveries.createdAt));
  return { invoice: invoiceView(invoice), deliveries, preview: invoice.payload ?? buildPayload(invoice.snapshot, invoice.environment, invoice.submittedAt?.toISOString() ?? new Date().toISOString()) };
}
const saveSchema = z.object({ id: uuid.optional(), revision: z.number().int().positive().optional(), requestKey: z.string().min(16).max(120), draft: draftSchema }).strict();
export async function saveDraft(user: SessionUser, input: unknown) {
  user = await fiscalAccess(user); const data = saveSchema.parse(input), c = await fiscalConfig(user.companyId);
  await assertFeature(user, "invoices", data.id ? "edit" : "create");
  const [customer] = await db.select().from(customers).where(and(eq(customers.id, data.draft.customerId), eq(customers.companyId, user.companyId), eq(customers.active, true)));
  if (!customer) fail("Cliente não pertence à empresa ou está inativo", 404);
  if (data.draft.orderId) {
    const [order] = await db.select().from(orders).where(and(eq(orders.id, data.draft.orderId), eq(orders.companyId, user.companyId)));
    if (!order || order.customerId !== customer.id) fail("Pedido não pertence ao cliente informado", 404);
  }
  const products = await db.select({ id: catalogItems.id }).from(catalogItems).where(and(eq(catalogItems.companyId, user.companyId), eq(catalogItems.active, true)));
  const ids = new Set(products.map(p => p.id)); if (data.draft.items.some(i => !ids.has(i.catalogItemId))) fail("Produto não pertence à empresa ou está inativo", 404);
  const profile = c.preferences.profiles.find(p => p.id === data.draft.profileId && p.active && p.reviewed);
  if (!profile) fail("Selecione um perfil fiscal ativo e revisado");
  const snapshot: FiscalSnapshot = { draft: data.draft, emitter: c.preferences.emitter, profile,
    productTaxes: taxSnapshot(c.preferences, data.draft) };
  buildPayload(snapshot, c.preferences.environment, new Date().toISOString());
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [configNow] = await tx.select().from(fiscalSettings).where(eq(fiscalSettings.companyId, user.companyId));
    if (!sameFiscal(configNow?.preferences, c.preferences)) fail("A configuração fiscal mudou. Atualize a página e revise o rascunho.", 409);
    if (data.id) {
      const [row] = await tx.select().from(fiscalInvoices).where(and(eq(fiscalInvoices.id, data.id), eq(fiscalInvoices.companyId, user.companyId)));
      if (!row) fail("NF-e não encontrada", 404);
      if (!["rascunho", "rejeitada"].includes(row.status) || data.revision !== row.revision) fail("A nota mudou ou já está em emissão. Atualize antes de editar.", 409);
      if (row.environment !== c.preferences.environment) fail("Restaure o ambiente fiscal do rascunho antes de editá-lo", 409);
      const [updated] = await tx.update(fiscalInvoices).set({ customerId: customer.id, orderId: data.draft.orderId, snapshot, productsCents: productsCents(data.draft.items), status: "rascunho", revision: row.revision + 1, payload: null, message: null, providerStatus: null, submittedAt: null, updatedAt: new Date() }).where(eq(fiscalInvoices.id, row.id)).returning();
      await audit(tx, user, "nfe_rascunho_atualizado", { id: row.id, revision: updated.revision }, row.orderId ?? undefined); return { invoice: invoiceView(updated) };
    }
    const [old] = await tx.select().from(fiscalInvoices).where(and(eq(fiscalInvoices.companyId, user.companyId), eq(fiscalInvoices.requestKey, data.requestKey)));
    if (old) { if (!sameFiscal(old.snapshot.draft, snapshot.draft)) fail("Chave de operação já usada para outro rascunho", 409); return { invoice: invoiceView(old), duplicate: true }; }
    const id = randomUUID();
    const [created] = await tx.insert(fiscalInvoices).values({ id, companyId: user.companyId, customerId: customer.id, orderId: data.draft.orderId, requestKey: data.requestKey, reference: `detali-${id}`, environment: c.preferences.environment, snapshot, productsCents: productsCents(data.draft.items), createdBy: user.id }).returning();
    await audit(tx, user, "nfe_rascunho_criado", { id, environment: created.environment }, created.orderId ?? undefined); return { invoice: invoiceView(created) };
  });
}
export async function issueInvoice(user: SessionUser, input: unknown) {
  await assertFeature(user, "invoices", "create");
  user = await fiscalAccess(user);
  const data = z.object({ id: uuid, revision: z.number().int().positive(), confirmation: z.literal("EMITIR") }).strict().parse(input);
  const c = await fiscalConfig(user.companyId);
  const prepared = await db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [row] = await tx.select().from(fiscalInvoices).where(and(eq(fiscalInvoices.id, data.id), eq(fiscalInvoices.companyId, user.companyId)));
    if (!row) fail("NF-e não encontrada", 404);
    if (row.revision !== data.revision) fail("O rascunho foi alterado. Revise novamente.", 409);
    if (row.status !== "rascunho") return { row, claimed: false };
    const [current] = await tx.select().from(fiscalSettings).where(eq(fiscalSettings.companyId, user.companyId));
    if (!sameFiscal(current?.preferences, c.preferences)) fail("A configuração fiscal mudou. Revise novamente.", 409);
    if (row.environment !== c.preferences.environment) fail("O rascunho pertence a outro ambiente fiscal. Restaure o ambiente ou crie um novo rascunho.", 409);
    if (row.environment === "producao" && !c.preferences.productionEnabled) fail("A emissão em produção ainda não foi liberada pelo gestor", 503);
    const profile = c.preferences.profiles.find(p => p.id === row.snapshot.profile.id);
    const productTaxes = taxSnapshot(c.preferences, row.snapshot.draft);
    if (!sameFiscal(profile, row.snapshot.profile) || !sameFiscal(c.preferences.emitter, row.snapshot.emitter) || !sameFiscal(productTaxes, row.snapshot.productTaxes)) fail("O perfil ou cadastro fiscal mudou. Edite e salve o rascunho para revisar os novos dados.", 409);
    fiscalToken(c, row.environment);
    const submittedAt = new Date(), payload = buildPayload(row.snapshot, row.environment, submittedAt.toISOString());
    const [claimed] = await tx.update(fiscalInvoices).set({ payload, status: "enviando", submittedAt, updatedAt: submittedAt }).where(eq(fiscalInvoices.id, row.id)).returning();
    await audit(tx, user, "nfe_emissao_solicitada", { id: row.id, reference: row.reference, revision: row.revision, environment: row.environment }, row.orderId ?? undefined);
    return { row: claimed, claimed: true };
  });
  if (!prepared.claimed) return { invoice: invoiceView(prepared.row), duplicate: true };
  try {
    const result = await focusRequest(prepared.row.environment, fiscalToken(c, prepared.row.environment), prepared.row.reference, prepared.row.payload!);
    return { invoice: invoiceView(await applyResult(user, prepared.row, result)) };
  } catch (error) {
    const definitive = error instanceof FiscalProviderError && error.definitive;
    const message = definitive ? error.message : "Resultado da emissão incerto. Consulte esta referência antes de qualquer nova emissão; o pedido pode ter sido recebido.";
    await db.update(fiscalInvoices).set({ status: definitive ? "rejeitada" : "incerta", message, updatedAt: new Date() }).where(and(eq(fiscalInvoices.id, prepared.row.id), eq(fiscalInvoices.status, "enviando")));
    fail(message, 502);
  }
}
async function applyResult(user: SessionUser, row: InvoiceRow, response: Record<string, unknown>) {
  const result = fiscalResult(response, { reference: row.reference, taxId: row.snapshot.emitter.taxId });
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [current] = await tx.select().from(fiscalInvoices).where(and(eq(fiscalInvoices.id, row.id), eq(fiscalInvoices.companyId, user.companyId)));
    if (!current || current.revision !== row.revision) fail("A nota mudou durante a consulta. Atualize a página.", 409);
    // Uma consulta atrasada não regride autorização/cancelamento confirmado.
    if (current.status === "cancelada" || current.status === "autorizada" && !["autorizada", "cancelada"].includes(result.status)) return current;
    if (current.accessKey && result.accessKey && current.accessKey !== result.accessKey) fail("A chave retornada diverge da NF-e já autorizada. Confira o provedor.", 502);
    const [updated] = await tx.update(fiscalInvoices).set({ ...result, number: result.number ?? current.number, series: result.series ?? current.series, accessKey: result.accessKey ?? current.accessKey,
      protocol: result.protocol ?? current.protocol, pdfPath: result.pdfPath ?? current.pdfPath, xmlPath: result.xmlPath ?? current.xmlPath, updatedAt: new Date() }).where(eq(fiscalInvoices.id, row.id)).returning();
    await audit(tx, user, "nfe_status_consultado", { id: row.id, status: result.status, providerStatus: result.providerStatus }, row.orderId ?? undefined); return updated;
  });
}
export async function syncInvoice(user: SessionUser, input: unknown) {
  await assertFeature(user, "invoices", "view");
  user = await fiscalAccess(user); const { id } = z.object({ id: uuid }).strict().parse(input), row = await findInvoice(user, id);
  if (row.status === "rascunho") fail("Este rascunho ainda não foi enviado para emissão", 409);
  if (row.status === "enviando" && row.submittedAt && Date.now() - row.submittedAt.getTime() < 30000) fail("Aguarde o término da solicitação de emissão antes de consultar", 409);
  const c = await fiscalConfig(user.companyId);
  try { return { invoice: invoiceView(await applyResult(user, row, await focusRequest(row.environment, fiscalToken(c, row.environment), row.reference))) }; }
  catch (error) { if (error instanceof FiscalProviderError) fail(error.notFound ? "Referência ainda não encontrada no provedor. Confira no painel fiscal antes de criar outra nota. Nenhuma reemissão foi feita." : error.message, 502); fail("Não foi possível confirmar o resultado no provedor. Nenhuma reemissão foi feita.", 502); }
}
export async function invoiceFile(user: SessionUser, id: string, format: "pdf" | "xml", refresh = true) {
  user = await fiscalAccess(user); let row = await findInvoice(user, id);
  if (row.status !== "autorizada") fail("O documento só fica disponível após autorização da NF-e", 409);
  if (refresh) { await syncInvoice(user, { id }); row = await findInvoice(user, id); }
  if (row.status !== "autorizada") fail("A NF-e não está autorizada no provedor", 409);
  const cached = format === "pdf" ? row.pdfData : row.xmlData, checksum = format === "pdf" ? row.pdfSha256 : row.xmlSha256;
  let buffer: Buffer;
  if (cached) { buffer = Buffer.from(cached, "base64"); if (createHash("sha256").update(buffer).digest("hex") !== checksum) fail("Falha de integridade do arquivo fiscal", 500); }
  else {
    const file = format === "pdf" ? row.pdfPath : row.xmlPath; if (!file) fail("O provedor ainda não disponibilizou este arquivo. Consulte novamente.", 409);
    const c = await fiscalConfig(user.companyId); buffer = await focusFile(row.environment, fiscalToken(c, row.environment), file, format);
    if (format === "xml" && !buffer.toString("utf8").includes(row.accessKey!)) fail("O XML retornado não corresponde à chave desta NF-e", 502);
    const hash = createHash("sha256").update(buffer).digest("hex");
    await db.update(fiscalInvoices).set(format === "pdf" ? { pdfData: buffer.toString("base64"), pdfSha256: hash } : { xmlData: buffer.toString("base64"), xmlSha256: hash }).where(and(eq(fiscalInvoices.id, row.id), eq(fiscalInvoices.companyId, user.companyId), eq(fiscalInvoices.status, "autorizada")));
  }
  await db.transaction(tx => audit(tx, user, "nfe_arquivo_acessado", { id, format }));
  return { buffer, filename: `nfe-${row.environment === "homologacao" ? "TESTE-" : ""}${row.number ?? id}.${format}`, row };
}
