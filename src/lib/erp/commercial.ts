import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { db } from "@/lib/db";
import { rentalDocuments, customers, catalogItems, companySettings, companies, memberships, users,
  orders, orderItems, financialEntries, settlements, commissions, paymentCheckouts } from "@/lib/db/schema";
import { and, eq, sql, desc, inArray } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import type { RentalLine, DocumentSnapshot } from "./types";
import { cents, uuid, day, fail, audit, lockCompany, assertSafeCents, localDay, proportion } from "./common";
import { periodAvailability } from "./inventory";
import type { Tx } from "./common";

export const quoteSchema = z.object({
  customerId: uuid, sellerId: uuid.nullable().optional(),
  eventName: z.string().trim().min(1).max(300), eventDate: day, returnDueDate: day,
  validUntil: day.optional(), deliveryAddress: z.string().max(2000).default(""),
  deliveryCents: cents.default(0), discountCents: cents.default(0),
  terms: z.string().max(30000).default(""), notes: z.string().max(5000).default(""),
  lines: z.array(z.object({ catalogItemId: uuid.nullable(), name: z.string().trim().min(1).max(300),
    unit: z.string().min(1).max(20), qty: z.number().int().positive().max(100000),
    priceCents: cents, periods: z.number().int().min(1).max(3660).default(1) })).min(1).max(200),
}).refine(d => d.returnDueDate >= d.eventDate, "A devolução não pode ser anterior ao evento");
export function quoteTotals(lines: RentalLine[], deliveryCents: number, discountCents: number) {
  const subtotalCents = assertSafeCents(lines.reduce((sum, line) => sum + line.qty * line.priceCents * line.periods, 0));
  if (discountCents > subtotalCents + deliveryCents) fail("O desconto excede o valor do orçamento");
  return { subtotalCents, totalCents: assertSafeCents(subtotalCents + deliveryCents - discountCents) };
}
export async function createQuote(user: SessionUser, input: unknown, executor?: Tx) {
  const data = quoteSchema.parse(input);
  const totals = quoteTotals(data.lines, data.deliveryCents, data.discountCents);
  const create = async (tx: Tx) => {
    await lockCompany(tx, user.companyId);
    const [customer] = await tx.select().from(customers).where(and(eq(customers.id, data.customerId), eq(customers.companyId, user.companyId), eq(customers.active, true)));
    if (!customer) fail("Cliente não encontrado", 404);
    const ids = [...new Set(data.lines.flatMap(l => l.catalogItemId ? [l.catalogItemId] : []))];
    if (ids.length) {
      const found = await tx.select({ id: catalogItems.id }).from(catalogItems).where(and(inArray(catalogItems.id, ids), eq(catalogItems.companyId, user.companyId), eq(catalogItems.active, true)));
      if (found.length !== ids.length) fail("Item de catálogo inválido para a empresa");
    }
    if (data.sellerId) {
      const [member] = await tx.select({ id: users.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.companyId, user.companyId), eq(users.id, data.sellerId), eq(users.active, true)));
      if (!member) fail("Vendedor não encontrado na equipe");
    }
    const [{ number }] = await tx.select({ number: sql<number>`coalesce(max(${rentalDocuments.number}), 0)::int` }).from(rentalDocuments)
      .where(and(eq(rentalDocuments.companyId, user.companyId), eq(rentalDocuments.kind, "orcamento")));
    const [configuration] = await tx.select({ preferences: companySettings.preferences }).from(companySettings).where(eq(companySettings.companyId, user.companyId));
    const validity = new Date(`${localDay(user.timezone)}T12:00:00Z`);
    validity.setUTCDate(validity.getUTCDate() + (configuration?.preferences.quoteValidityDays ?? 15));
    const [document] = await tx.insert(rentalDocuments).values({ ...data, ...totals, companyId: user.companyId,
      validUntil: data.validUntil ?? validity.toISOString().slice(0, 10),
      kind: "orcamento", number: number + 1, createdBy: user.id }).returning();
    await audit(tx, user, "orcamento_criado", { documentId: document.id, totalCents: document.totalCents });
    return { document };
  };
  return executor ? create(executor) : db.transaction(create);
}

export async function reviseQuote(user: SessionUser, input: unknown) {
  const schema = quoteSchema.safeExtend({ id: uuid });
  const data = schema.parse(input); const totals = quoteTotals(data.lines, data.deliveryCents, data.discountCents);
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [current] = await tx.select().from(rentalDocuments).where(and(eq(rentalDocuments.id, data.id), eq(rentalDocuments.companyId, user.companyId))).for("update");
    if (!current || current.kind !== "orcamento") fail("Orçamento não encontrado", 404);
    if (["contratado", "cancelado"].includes(current.status)) fail("Orçamento indisponível para edição");
    const [customer] = await tx.select().from(customers).where(and(eq(customers.id, data.customerId), eq(customers.companyId, user.companyId), eq(customers.active, true)));
    if (!customer) fail("Cliente não encontrado", 404);
    const ids = [...new Set(data.lines.flatMap(l => l.catalogItemId ? [l.catalogItemId] : []))];
    if (ids.length) {
      const found = await tx.select({ id: catalogItems.id }).from(catalogItems).where(and(inArray(catalogItems.id, ids), eq(catalogItems.companyId, user.companyId), eq(catalogItems.active, true)));
      if (found.length !== ids.length) fail("Item de catálogo inválido");
    }
    if (data.sellerId && data.sellerId !== current.sellerId) fail("Emita outra proposta para alterar o vendedor");
    const { id, ...values } = data;
    const [document] = await tx.update(rentalDocuments).set({ ...values, ...totals, status: "rascunho", shareTokenHash: null, shareExpiresAt: null, updatedAt: new Date() }).where(eq(rentalDocuments.id, id)).returning();
    await audit(tx, user, "orcamento_revisado", { documentId: id, totalCents: document.totalCents });
    return { document };
  });
}

const contractSchema = z.object({ id: uuid,
  installments: z.array(z.object({ dueDate: day, amountCents: cents })).min(1).max(120),
  commissionBps: z.number().int().min(0).max(10000).nullable().optional(),
  commissionBasis: z.enum(["recebimento", "contrato"]).optional(),
  terms: z.string().max(30000).optional(),
});
export async function convertToContract(user: SessionUser, input: unknown) {
  const data = contractSchema.parse(input);
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [quote] = await tx.select().from(rentalDocuments).where(and(eq(rentalDocuments.id, data.id), eq(rentalDocuments.companyId, user.companyId))).for("update");
    if (!quote || quote.kind !== "orcamento") fail("Orçamento não encontrado", 404);
    if (quote.status === "contratado") {
      const [existing] = await tx.select().from(rentalDocuments).where(and(eq(rentalDocuments.parentId, quote.id), eq(rentalDocuments.companyId, user.companyId)));
      if (existing) return { document: existing, duplicated: true };
    }
    if (["cancelado", "contratado"].includes(quote.status)) fail("Orçamento indisponível para contratação");
    if (quote.validUntil && quote.validUntil < localDay(user.timezone)) fail("O orçamento expirou; emita uma nova proposta");
    if (data.installments.reduce((sum, p) => sum + p.amountCents, 0) !== quote.totalCents) fail("A soma das parcelas deve ser igual ao total do contrato");
    if (quote.totalCents > 0 && data.installments.some(p => p.amountCents === 0)) fail("Parcelas devem ter valor maior que zero");
    const [settings] = await tx.select().from(companySettings).where(eq(companySettings.companyId, user.companyId));
    const [company] = await tx.select().from(companies).where(eq(companies.id, user.companyId));
    const [customer] = await tx.select().from(customers).where(and(eq(customers.id, quote.customerId), eq(customers.companyId, user.companyId)));
    if (!customer) fail("Cliente não encontrado", 404);
    const prefs = settings?.preferences ?? {};
    const terms = data.terms?.trim() || quote.terms.trim() || prefs.contractTerms?.trim();
    if (!terms) fail("Configure o modelo de contrato ou informe as cláusulas antes de emitir");
    if (!prefs.taxId || !prefs.legalName || !prefs.address) fail("Configure razão social, CPF/CNPJ e endereço da locadora antes de emitir contratos");
    if (!customer.taxId || !customer.address) fail("Complete CPF/CNPJ e endereço do cliente antes de emitir o contrato");
    const wanted = new Map<string, number>();
    for (const line of quote.lines) if (line.catalogItemId) wanted.set(line.catalogItemId, (wanted.get(line.catalogItemId) ?? 0) + line.qty);
    if (wanted.size) {
      await tx.select({ id: catalogItems.id }).from(catalogItems).where(and(inArray(catalogItems.id, [...wanted.keys()]), eq(catalogItems.companyId, user.companyId))).orderBy(catalogItems.id).for("update");
      const availability = await periodAvailability(user, quote.eventDate, quote.returnDueDate, tx);
      for (const [id, qty] of wanted) {
        const item = availability.find(i => i.id === id);
        if (!item || item.available === null) fail("Informe o estoque dos itens antes de confirmar o contrato");
        if (qty > item.available) fail(`Estoque insuficiente para ${item.name}: ${item.available} disponível(is) no período`);
      }
    }
    let rate = data.commissionBps ?? prefs.defaultCommissionBps ?? null;
    if (quote.sellerId) {
      const [seller] = await tx.select({ rate: memberships.commissionBps }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.companyId, user.companyId), eq(users.id, quote.sellerId), eq(users.active, true)));
      if (!seller) fail("Vendedor inativo ou fora da equipe");
      rate = data.commissionBps ?? seller.rate ?? prefs.defaultCommissionBps ?? null;
      if (rate === null) fail("Configure a comissão do vendedor ou informe explicitamente 0% para contrato sem comissão");
    }
    const basis = data.commissionBasis ?? prefs.commissionBasis ?? "recebimento";
    const commissionBaseCents = prefs.commissionBase === "total" ? quote.totalCents : Math.max(0, quote.subtotalCents - quote.discountCents);
    const [{ number: contractNumber }] = await tx.select({ number: sql<number>`coalesce(max(${rentalDocuments.number}), 0)::int` }).from(rentalDocuments)
      .where(and(eq(rentalDocuments.companyId, user.companyId), eq(rentalDocuments.kind, "contrato")));
    const [{ number: orderNumber }] = await tx.select({ number: sql<number>`coalesce(max(${orders.number}), 1000)::int` }).from(orders).where(eq(orders.companyId, user.companyId));
    const [order] = await tx.insert(orders).values({ companyId: user.companyId, number: orderNumber + 1,
      customerId: customer.id, eventName: quote.eventName, eventDate: quote.eventDate,
      returnDueDate: quote.returnDueDate, notes: quote.notes, createdBy: user.id }).returning();
    await tx.insert(orderItems).values(quote.lines.map((line, position) => ({ orderId: order.id,
      catalogItemId: line.catalogItemId, name: line.name, unit: line.unit, qtyPlanned: line.qty, position })));
    const snapshot: DocumentSnapshot = { company: { name: prefs.legalName ?? company.name, taxId: prefs.taxId,
      address: prefs.address, email: prefs.email ?? "", phone: prefs.phone ?? "" },
      customer: { name: customer.name, taxId: customer.taxId, address: customer.address, email: customer.email, phone: customer.phone },
      lines: quote.lines, terms };
    const [document] = await tx.insert(rentalDocuments).values({ companyId: user.companyId, kind: "contrato", status: "emitido",
      number: contractNumber + 1, customerId: customer.id, sellerId: quote.sellerId, orderId: order.id, parentId: quote.id,
      eventName: quote.eventName, eventDate: quote.eventDate, returnDueDate: quote.returnDueDate,
      lines: quote.lines, subtotalCents: quote.subtotalCents, deliveryCents: quote.deliveryCents,
      discountCents: quote.discountCents, totalCents: quote.totalCents, terms, notes: quote.notes,
      deliveryAddress: quote.deliveryAddress, commissionBps: rate, commissionBasis: basis,
      commissionBaseCents, snapshot, createdBy: user.id }).returning();
    if (quote.totalCents > 0) await tx.insert(financialEntries).values(data.installments.map((p, index) => ({
      companyId: user.companyId, direction: "receber", documentId: document.id, customerId: customer.id,
      installment: index + 1, description: `Contrato #${document.number} · parcela ${index + 1}/${data.installments.length}`,
      category: "locacao", amountCents: p.amountCents, dueDate: p.dueDate, createdBy: user.id,
    })));
    if (quote.sellerId && rate !== null && rate > 0 && basis === "contrato") {
      const amount = proportion(commissionBaseCents, rate, 10000);
      if (amount > 0) await tx.insert(commissions).values({ companyId: user.companyId, documentId: document.id,
        sellerId: quote.sellerId, amountCents: amount, rateBps: rate, basis });
    }
    await tx.update(rentalDocuments).set({ status: "contratado", updatedAt: new Date() }).where(eq(rentalDocuments.id, quote.id));
    await audit(tx, user, "contrato_emitido", { documentId: document.id, quoteId: quote.id, totalCents: document.totalCents }, order.id);
    return { document, duplicated: false };
  });
}

export async function cancelDocument(user: SessionUser, input: unknown) {
  const data = z.object({ id: uuid, reason: z.string().trim().min(3).max(2000) }).parse(input);
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [doc] = await tx.select().from(rentalDocuments).where(and(eq(rentalDocuments.id, data.id), eq(rentalDocuments.companyId, user.companyId))).for("update");
    if (!doc) fail("Documento não encontrado", 404);
    if (doc.status === "cancelado") return { ok: true };
    if (doc.status === "contratado") fail("Cancele o contrato gerado a partir deste orçamento");
    if (doc.signature?.token || doc.signedAt) fail("Cancele o processo de assinatura no provedor antes de cancelar o contrato");
    if (doc.orderId) {
      const [order] = await tx.select().from(orders).where(eq(orders.id, doc.orderId)).for("update");
      if (order?.status !== "rascunho") fail("Contrato com saída confirmada exige devolução e fechamento antes de cancelamento");
      const [paid] = await tx.select({ amount: sql<number>`coalesce(sum(${settlements.amountCents}), 0)::float8` }).from(settlements)
        .innerJoin(financialEntries, eq(financialEntries.id, settlements.entryId)).where(eq(financialEntries.documentId, doc.id));
      if (paid.amount > 0) fail("Contrato com pagamento exige estorno e conciliação antes do cancelamento");
      const [online] = await tx.select({ id: paymentCheckouts.id }).from(paymentCheckouts)
        .innerJoin(financialEntries, eq(financialEntries.id, paymentCheckouts.entryId))
        .where(and(eq(financialEntries.documentId, doc.id), inArray(paymentCheckouts.status, ["ativo", "criando", "incerto"])));
      if (online) fail("Contrato com cobrança online ativa exige conciliação no PagBank antes de cancelar", 409);
      await tx.update(orders).set({ status: "cancelado" }).where(eq(orders.id, doc.orderId));
      await tx.update(financialEntries).set({ cancelledAt: new Date(), cancelReason: data.reason }).where(eq(financialEntries.documentId, doc.id));
      await tx.update(commissions).set({ status: "cancelada" }).where(eq(commissions.documentId, doc.id));
    }
    await tx.update(rentalDocuments).set({ status: "cancelado", shareTokenHash: null, updatedAt: new Date() }).where(eq(rentalDocuments.id, doc.id));
    await audit(tx, user, "documento_cancelado", { documentId: doc.id, reason: data.reason }, doc.orderId ?? undefined);
    return { ok: true };
  });
}

export async function shareDocument(user: SessionUser, input: unknown) {
  const { id } = z.object({ id: uuid }).parse(input);
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  return db.transaction(async tx => {
    const [doc] = await tx.select().from(rentalDocuments).where(and(eq(rentalDocuments.id, id), eq(rentalDocuments.companyId, user.companyId))).for("update");
    if (!doc || doc.status === "cancelado") fail("Documento não disponível", 404);
    const expires = new Date(Date.now() + 30 * 86400000);
    await tx.update(rentalDocuments).set({ shareTokenHash: hash, shareExpiresAt: expires,
      status: doc.status === "rascunho" ? "enviado" : doc.status }).where(eq(rentalDocuments.id, id));
    await audit(tx, user, "documento_compartilhado", { documentId: id, expiresAt: expires.toISOString() });
    return { path: `/documento/${token}`, expiresAt: expires.toISOString() };
  });
}
export async function commercialData(user: SessionUser, query: URLSearchParams) {
  const id = query.get("id");
  const conditions = [eq(rentalDocuments.companyId, user.companyId)];
  if (id) conditions.push(eq(rentalDocuments.id, uuid.parse(id)));
  if (query.get("kind")) conditions.push(eq(rentalDocuments.kind, z.enum(["orcamento", "contrato"]).parse(query.get("kind"))));
  const rows = await db.select({ document: rentalDocuments, customerName: customers.name, sellerName: users.name })
    .from(rentalDocuments).innerJoin(customers, eq(customers.id, rentalDocuments.customerId))
    .leftJoin(users, eq(users.id, rentalDocuments.sellerId)).where(and(...conditions)).orderBy(desc(rentalDocuments.createdAt));
  return { documents: rows.map(({ document, customerName, sellerName }) => ({ ...document, shareTokenHash: undefined, customerName, sellerName })) };
}
