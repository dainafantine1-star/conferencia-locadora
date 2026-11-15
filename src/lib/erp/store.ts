import { assertFeature, assertPlan } from "@/lib/saas/access";
import { z } from "zod";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { companySettings, catalogItems, storePages, storeLeads, customers, rentalDocuments, financialEntries, settlements, requestLimits } from "@/lib/db/schema";
import { and, eq, sql, desc, inArray, gt } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { day, uuid, fail, audit, lockCompany, localDay } from "./common";
import { createQuote } from "./commercial";

export async function publicStore(slug: string) {
  const [settings] = await db.select({ companyId: companySettings.companyId, slug: companySettings.slug,
    storefront: companySettings.storefront }).from(companySettings).where(eq(companySettings.slug, slug));
  if (!settings?.storefront.enabled) fail("Loja não encontrada", 404);
  const [products, pages] = await Promise.all([
    db.select({ id: catalogItems.id, name: catalogItems.name, unit: catalogItems.unit, description: catalogItems.description,
      imageUrl: catalogItems.imageUrl, rentalPriceCents: catalogItems.rentalPriceCents, priceUnit: catalogItems.priceUnit, featured: catalogItems.featured })
      .from(catalogItems).where(and(eq(catalogItems.companyId, settings.companyId), eq(catalogItems.active, true), eq(catalogItems.published, true))).orderBy(catalogItems.name),
    db.select({ slug: storePages.slug, title: storePages.title }).from(storePages).where(and(eq(storePages.companyId, settings.companyId), eq(storePages.published, true))),
  ]);
  return { ...settings, products, pages };
}
export async function publicPage(slug: string, pageSlug: string) {
  const store = await publicStore(slug);
  const [page] = await db.select({ title: storePages.title, content: storePages.content }).from(storePages)
    .where(and(eq(storePages.companyId, store.companyId), eq(storePages.slug, pageSlug), eq(storePages.published, true)));
  if (!page) fail("Página não encontrada", 404);
  return { store, page };
}
export async function limitPublicRequests(key: string, limit = 20) {
  const hash = createHash("sha256").update(key).digest("hex");
  const now = new Date();
  const [row] = await db.insert(requestLimits).values({ key: hash, hits: 1, expiresAt: new Date(Date.now() + 3600000) })
    .onConflictDoUpdate({ target: requestLimits.key, set: {
      hits: sql`case when ${requestLimits.expiresAt} < ${now.toISOString()} then 1 else ${requestLimits.hits} + 1 end`,
      expiresAt: sql`case when ${requestLimits.expiresAt} < ${now.toISOString()} then ${new Date(Date.now() + 3600000).toISOString()} else ${requestLimits.expiresAt} end`,
    } }).returning();
  if (row.hits > limit) fail("Muitas solicitações. Tente novamente mais tarde.", 429);
}
const leadSchema = z.object({ kind: z.enum(["orcamento", "contato"]), name: z.string().trim().min(2).max(300),
  email: z.email().max(320), phone: z.string().trim().min(8).max(40), message: z.string().max(5000).default(""),
  eventDate: day.optional(), returnDueDate: day.optional(), requestKey: uuid,
  website: z.string().max(200).default(""), consent: z.literal(true),
  items: z.array(z.object({ catalogItemId: uuid, qty: z.number().int().positive().max(100000) })).max(200).default([]),
}).refine(v => v.kind === "contato" || (v.eventDate && v.returnDueDate && v.returnDueDate >= v.eventDate && v.items.length > 0), "Informe o período e selecione os produtos");
export async function submitLead(slug: string, input: unknown) {
  const data = leadSchema.parse(input);
  if (data.website) fail("Solicitação não aceita");
  const store = await publicStore(slug);
  const products = new Set(store.products.map(p => p.id));
  await assertPlan(store.companyId, "sites", "create");
  if (data.items.some(p => !products.has(p.catalogItemId))) fail("Produto indisponível nesta loja");
  if (data.eventDate && data.eventDate < localDay()) fail("Escolha uma data atual ou futura");
  const { requestKey, kind, name, email, phone, message, eventDate, returnDueDate, items } = data;
  const [lead] = await db.insert(storeLeads).values({ companyId: store.companyId, requestKey, kind, name, email, phone, message, eventDate, returnDueDate, items })
    .onConflictDoNothing().returning();
  if (lead) return { received: true, protocol: lead.id };
  const [existing] = await db.select({ id: storeLeads.id }).from(storeLeads).where(and(eq(storeLeads.companyId, store.companyId), eq(storeLeads.requestKey, requestKey)));
  return { received: true, protocol: existing.id };
}
export async function storeData(user: SessionUser) {
  await assertFeature(user, "sites", "view");
  const [pages, leads] = await Promise.all([
    db.select().from(storePages).where(eq(storePages.companyId, user.companyId)).orderBy(storePages.title),
    db.select().from(storeLeads).where(eq(storeLeads.companyId, user.companyId)).orderBy(desc(storeLeads.createdAt)),
  ]);
  return { pages, leads };
}
export async function savePage(user: SessionUser, input: unknown) {
  await assertFeature(user, "sites", "edit");
  const data = z.object({ id: uuid.optional(), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
    title: z.string().trim().min(1).max(200), content: z.string().max(50000), published: z.boolean() }).parse(input);
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [duplicate] = await tx.select().from(storePages).where(and(eq(storePages.companyId, user.companyId), eq(storePages.slug, data.slug)));
    if (duplicate && duplicate.id !== data.id) fail("Já existe uma página com esse endereço");
    const { id, ...values } = data;
    const [page] = id ? await tx.update(storePages).set({ ...values, updatedAt: new Date() }).where(and(eq(storePages.companyId, user.companyId), eq(storePages.id, id))).returning()
      : await tx.insert(storePages).values({ ...values, companyId: user.companyId }).returning();
    if (!page) fail("Página não encontrada", 404);
    await audit(tx, user, "pagina_salva", { id: page.id, published: page.published });
    return { page };
  });
}
export async function updateLead(user: SessionUser, input: unknown) {
  await assertFeature(user, "sites", "edit");
  const data = z.object({ id: uuid, status: z.enum(["em_atendimento", "concluido", "arquivado"]) }).parse(input);
  const [lead] = await db.update(storeLeads).set({ status: data.status }).where(and(eq(storeLeads.id, data.id), eq(storeLeads.companyId, user.companyId))).returning();
  if (!lead) fail("Solicitação não encontrada", 404);
  return { lead };
}
export async function quoteFromLead(user: SessionUser, input: unknown) {
  await assertFeature(user, "proposals", "create");
  const { id } = z.object({ id: uuid }).parse(input);
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
  const [lead] = await tx.select().from(storeLeads).where(and(eq(storeLeads.id, id), eq(storeLeads.companyId, user.companyId))).for("update");
  if (!lead || !lead.eventDate || !lead.returnDueDate || !lead.items.length) fail("Solicitação sem itens ou datas", 400);
  if (lead.documentId) return { document: { id: lead.documentId }, duplicated: true };
  const items = await tx.select().from(catalogItems).where(eq(catalogItems.companyId, user.companyId));
  const lines = lead.items.map(line => {
    const item = items.find(i => i.id === line.catalogItemId && i.active);
    if (!item || item.rentalPriceCents === null) fail("Cadastre o preço de locação de todos os itens antes de gerar o orçamento");
    return { catalogItemId: item.id, name: item.name, unit: item.unit, qty: line.qty, priceCents: item.rentalPriceCents, periods: 1 };
  });
  // Never merge unrelated clients merely because they submitted the same email.
  const [customer] = await tx.insert(customers).values({ companyId: user.companyId, name: lead.name, email: lead.email, phone: lead.phone, notes: `Solicitação da loja ${lead.id}` }).returning();
  const result = await createQuote(user, { customerId: customer.id, eventName: `Solicitação de ${lead.name}`, eventDate: lead.eventDate,
    returnDueDate: lead.returnDueDate, lines, notes: lead.message }, tx);
  await tx.update(storeLeads).set({ documentId: result.document.id, status: "em_atendimento" }).where(and(eq(storeLeads.id, id), eq(storeLeads.companyId, user.companyId)));
  return result;
  });
}
export async function sharedDocument(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) fail("Link inválido", 404);
  const hash = createHash("sha256").update(token).digest("hex");
  const [doc] = await db.select().from(rentalDocuments).where(eq(rentalDocuments.shareTokenHash, hash));
  if (!doc || !doc.shareExpiresAt || doc.shareExpiresAt < new Date() || doc.status === "cancelado") fail("Link expirado ou indisponível", 404);
  const [customer] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, doc.customerId));
  const [settings] = await db.select({ preferences: companySettings.preferences }).from(companySettings).where(eq(companySettings.companyId, doc.companyId));
  const rows = await db.select({ entry: financialEntries, paid: sql<number>`coalesce(sum(${settlements.amountCents}),0)::int` }).from(financialEntries)
    .leftJoin(settlements, eq(settlements.entryId, financialEntries.id)).where(and(eq(financialEntries.documentId, doc.id), eq(financialEntries.direction, "receber")))
    .groupBy(financialEntries.id).orderBy(financialEntries.installment);
  return { companyId: doc.companyId, id: doc.id, createdBy: doc.createdBy, kind: doc.kind, number: doc.number, status: doc.status,
    eventName: doc.eventName, eventDate: doc.eventDate, returnDueDate: doc.returnDueDate, validUntil: doc.validUntil,
    customerName: doc.snapshot?.customer.name ?? customer.name, companyName: doc.snapshot?.company.name ?? settings?.preferences.legalName ?? "Detali",
    lines: doc.lines, totalCents: doc.totalCents, subtotalCents: doc.subtotalCents, deliveryCents: doc.deliveryCents, discountCents: doc.discountCents,
    terms: doc.snapshot?.terms ?? doc.terms, signedAt: doc.signedAt, signUrl: doc.signature?.signUrl,
    installments: rows.map(({ entry, paid }) => ({ id: entry.id, installment: entry.installment, dueDate: entry.dueDate,
      amountCents: entry.amountCents, balanceCents: entry.cancelledAt ? 0 : entry.amountCents - entry.creditedCents - paid })),
  };
}
export async function acceptSharedQuote(token: string) {
  const linked = await sharedDocument(token); await assertPlan(linked.companyId, "proposals", "edit");
  const doc = await sharedDocument(token);
  if (doc.kind !== "orcamento" || !["rascunho", "enviado", "aceito"].includes(doc.status)) fail("Proposta indisponível para aceite");
  if (doc.validUntil && doc.validUntil < localDay()) fail("Proposta expirada");
  const [accepted] = await db.update(rentalDocuments).set({ status: "aceito", updatedAt: new Date() }).where(and(eq(rentalDocuments.id, doc.id),
    eq(rentalDocuments.shareTokenHash, createHash("sha256").update(token).digest("hex")), inArray(rentalDocuments.status, ["rascunho", "enviado", "aceito"]),
    gt(rentalDocuments.shareExpiresAt, new Date()))).returning();
  if (!accepted) fail("A proposta mudou ou o link expirou. Solicite um novo link.", 409);
  return { accepted: true, message: "Aceite registrado. A locadora confirmará estoque e contrato." };
}
