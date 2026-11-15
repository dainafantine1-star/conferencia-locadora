import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { financialEntries, settlements, commissions, rentalDocuments, customers, suppliers, users, closures, orders, billingEvents } from "@/lib/db/schema";
import { and, eq, sql, desc, gte, lte, isNull, gt, inArray } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { positiveCents, uuid, day, fail, localDay, audit, lockCompany, proportion, assertNoOpenCheckout, type Tx } from "./common";

const entrySchema = z.object({
  direction: z.enum(["pagar", "receber"]), description: z.string().trim().min(1).max(300),
  category: z.string().trim().min(1).max(80).default("geral"),
  customerId: uuid.nullable().optional(), supplierId: uuid.nullable().optional(),
  amountCents: positiveCents, dueDate: day,
}).refine(d => !(d.customerId && d.supplierId), "Selecione somente um cliente ou um fornecedor para a conta");
export const settlementSchema = z.object({
  entryId: uuid, amountCents: positiveCents,
  method: z.enum(["pix", "dinheiro", "cartao", "boleto", "transferencia", "pagbank", "outro"]),
  occurredAt: z.iso.datetime().optional(), note: z.string().max(2000).default(""),
  idempotencyKey: z.string().min(16).max(120),
});
export async function createFinancialEntry(user: SessionUser, input: unknown) {
  const data = entrySchema.parse(input);
  return db.transaction(async tx => {
    if (data.customerId) {
      const [found] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, data.customerId), eq(customers.companyId, user.companyId)));
      if (!found) fail("Cliente não encontrado", 404);
    }
    if (data.supplierId) {
      const [found] = await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, data.supplierId), eq(suppliers.companyId, user.companyId)));
      if (!found) fail("Fornecedor não encontrado", 404);
    }
    const [entry] = await tx.insert(financialEntries).values({ ...data, companyId: user.companyId, createdBy: user.id }).returning();
    await audit(tx, user, "conta_criada", { entryId: entry.id, direction: entry.direction, amountCents: entry.amountCents });
    return { entry };
  });
}

export async function recordSettlement(tx: Tx, user: SessionUser, input: z.infer<typeof settlementSchema>, providerId?: string) {
  await lockCompany(tx, user.companyId);
  const [existing] = await tx.select().from(settlements).where(and(eq(settlements.companyId, user.companyId), eq(settlements.idempotencyKey, input.idempotencyKey)));
  if (existing) {
    if (existing.entryId !== input.entryId || existing.amountCents !== input.amountCents || existing.method !== input.method) fail("Chave de pagamento já utilizada com outros dados");
    return { settlement: existing, duplicated: true };
  }
  const [entry] = await tx.select().from(financialEntries).where(and(eq(financialEntries.id, input.entryId), eq(financialEntries.companyId, user.companyId))).for("update");
  if (!entry) fail("Conta não encontrada", 404);
  if (entry.cancelledAt) fail("Conta cancelada não pode receber baixa");
  if (!providerId) await assertNoOpenCheckout(tx, user.companyId, entry.id);
  const [{ total }] = await tx.select({ total: sql<number>`coalesce(sum(${settlements.amountCents}), 0)::float8` }).from(settlements).where(eq(settlements.entryId, entry.id));
  if (input.amountCents > entry.amountCents - entry.creditedCents - total) fail("O pagamento excede o saldo em aberto");
  const at = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (at.getTime() > Date.now() + 60000) fail("A data de uma baixa não pode estar no futuro");
  const [customer] = entry.customerId ? await tx.select().from(customers).where(eq(customers.id, entry.customerId)) : [];
  const [supplier] = entry.supplierId ? await tx.select().from(suppliers).where(eq(suppliers.id, entry.supplierId)) : [];
  const id = randomUUID();
  const [settlement] = await tx.insert(settlements).values({
    id, companyId: user.companyId, entryId: entry.id, amountCents: input.amountCents,
    method: input.method, occurredAt: at, note: input.note, idempotencyKey: input.idempotencyKey,
    providerId, receiptNumber: `REC-${id.toUpperCase()}`,
    receiptSnapshot: { party: customer?.name ?? supplier?.name ?? "", taxId: customer?.taxId ?? supplier?.taxId ?? "",
      description: entry.description, direction: entry.direction, company: user.companyName, amountCents: input.amountCents, method: input.method, occurredAt: at.toISOString() },
    createdBy: user.id,
  }).returning();
  if (entry.closureId && entry.direction === "receber" && total + input.amountCents + entry.creditedCents >= entry.amountCents) {
    const [closure] = await tx.select().from(closures).where(eq(closures.id, entry.closureId));
    if (closure) {
      await tx.update(orders).set({ billingStatus: "recebida" }).where(and(eq(orders.id, closure.orderId), eq(orders.activeClosureId, closure.id)));
      await tx.insert(billingEvents).values({ companyId: user.companyId, orderId: closure.orderId,
        status: "recebida", amountCents: input.amountCents, note: "Baixa vinculada ao financeiro", createdBy: user.id });
    }
  }
  if (entry.direction === "receber" && entry.documentId) {
    const [doc] = await tx.select().from(rentalDocuments).where(and(eq(rentalDocuments.id, entry.documentId), eq(rentalDocuments.companyId, user.companyId))).for("update");
    if (doc?.sellerId && doc.commissionBps !== null && doc.commissionBasis === "recebimento" && doc.totalCents > 0) {
      const [paid] = await tx.select({ total: sql<number>`coalesce(sum(${settlements.amountCents}), 0)::float8` }).from(settlements)
        .innerJoin(financialEntries, eq(financialEntries.id, settlements.entryId)).where(and(eq(financialEntries.documentId, doc.id), eq(financialEntries.direction, "receber")));
      const [prior] = await tx.select({ total: sql<number>`coalesce(sum(${commissions.amountCents}), 0)::float8` }).from(commissions).where(eq(commissions.documentId, doc.id));
      const commissionTotal = proportion(doc.commissionBaseCents ?? doc.totalCents, doc.commissionBps, 10000);
      const accrued = proportion(commissionTotal, Math.min(paid.total, doc.totalCents), doc.totalCents);
      const amount = accrued - prior.total;
      if (amount > 0) await tx.insert(commissions).values({ companyId: user.companyId, documentId: doc.id,
        sellerId: doc.sellerId, settlementId: settlement.id, amountCents: amount, rateBps: doc.commissionBps, basis: "recebimento" });
    }
  }
  await audit(tx, user, entry.direction === "receber" ? "recebimento_registrado" : "pagamento_registrado", { entryId: entry.id, settlementId: settlement.id, amountCents: input.amountCents, method: input.method });
  return { settlement, duplicated: false };
}
export async function settleEntry(user: SessionUser, input: unknown) {
  const data = settlementSchema.parse(input);
  if (data.method === "pagbank") fail("Pagamentos PagBank são confirmados exclusivamente pelo provedor");
  return db.transaction(tx => recordSettlement(tx, user, data));
}
export async function cancelEntry(user: SessionUser, input: unknown) {
  const data = z.object({ id: uuid, reason: z.string().trim().min(3).max(2000) }).parse(input);
  return db.transaction(async tx => {
    const [entry] = await tx.select().from(financialEntries).where(and(eq(financialEntries.id, data.id), eq(financialEntries.companyId, user.companyId))).for("update");
    if (!entry) fail("Conta não encontrada", 404);
    if (entry.documentId) fail("Cancele a conta pelo contrato para manter as parcelas consistentes");
    if (entry.closureId) fail("Altere esta cobrança pela conferência para preservar o saldo do pedido");
    await assertNoOpenCheckout(tx, user.companyId, entry.id);
    const [{ total }] = await tx.select({ total: sql<number>`coalesce(sum(${settlements.amountCents}), 0)::float8` }).from(settlements).where(eq(settlements.entryId, entry.id));
    if (total !== 0) fail("Conta com pagamento exige estorno e conciliação antes do cancelamento");
    await tx.update(financialEntries).set({ cancelledAt: new Date(), cancelReason: data.reason }).where(eq(financialEntries.id, entry.id));
    await audit(tx, user, "conta_cancelada", data);
    return { ok: true };
  });
}

export async function financeData(user: SessionUser, query: URLSearchParams) {
  const conditions = [eq(financialEntries.companyId, user.companyId)];
  const direction = query.get("direction");
  if (direction) conditions.push(eq(financialEntries.direction, z.enum(["pagar", "receber"]).parse(direction)));
  const documentId = query.get("documentId");
  if (documentId) conditions.push(eq(financialEntries.documentId, uuid.parse(documentId)));
  if (query.get("start")) conditions.push(gte(financialEntries.dueDate, day.parse(query.get("start"))));
  if (query.get("end")) conditions.push(lte(financialEntries.dueDate, day.parse(query.get("end"))));
  const paid = db.select({ entryId: settlements.entryId, amount: sql<number>`sum(${settlements.amountCents})::float8`.as("paid") })
    .from(settlements).groupBy(settlements.entryId).as("paid_totals");
  const rows = await db.select({ entry: financialEntries, paidCents: sql<number>`coalesce(${paid.amount}, 0)::int`,
    customerName: customers.name, supplierName: suppliers.name }).from(financialEntries)
    .leftJoin(paid, eq(paid.entryId, financialEntries.id)).leftJoin(customers, eq(customers.id, financialEntries.customerId))
    .leftJoin(suppliers, eq(suppliers.id, financialEntries.supplierId)).where(and(...conditions)).orderBy(financialEntries.dueDate);
  const today = localDay(user.timezone);
  const entries = rows.map(({ entry, paidCents, customerName, supplierName }) => ({ ...entry, paidCents,
    balanceCents: entry.cancelledAt ? 0 : entry.amountCents - entry.creditedCents - paidCents,
    status: entry.cancelledAt ? "cancelada" : paidCents + entry.creditedCents >= entry.amountCents ? "quitada" : entry.dueDate < today ? "atrasada" : paidCents > 0 ? "parcial" : "pendente",
    party: customerName ?? supplierName ?? "",
  }));
  const history = await db.select().from(settlements).where(eq(settlements.companyId, user.companyId)).orderBy(desc(settlements.occurredAt)).limit(200);
  const legacyConferences = await db.select({ orderId: orders.id, number: orders.number, eventName: orders.eventName,
    closureId: closures.id, finalCents: closures.finalCents, status: orders.billingStatus, closedAt: closures.closedAt }).from(orders)
    .innerJoin(closures, eq(closures.id, orders.activeClosureId)).leftJoin(financialEntries, eq(financialEntries.closureId, closures.id))
    .where(and(eq(orders.companyId, user.companyId), eq(orders.status, "encerrado"), isNull(financialEntries.id), gt(closures.finalCents, 0), inArray(orders.billingStatus, ["pendente", "recebida"])));
  return { entries, settlements: history, legacyConferences, totals: {
    pagar: entries.filter(e => e.direction === "pagar").reduce((sum, e) => sum + e.balanceCents, 0),
    receber: entries.filter(e => e.direction === "receber").reduce((sum, e) => sum + e.balanceCents, 0),
    liquidado: entries.filter(e => !e.cancelledAt).reduce((sum, e) => sum + e.paidCents, 0),
  } };
}

export async function importConference(user: SessionUser, input: unknown) {
  const data = z.object({ orderId: uuid, dueDate: day, receivedCents: z.number().int().nonnegative(),
    occurredAt: z.iso.datetime().optional(), method: settlementSchema.shape.method, confirmed: z.literal(true) }).parse(input);
  if (data.method === "pagbank") fail("Uma importação histórica não confirma pagamentos no provedor");
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, data.orderId), eq(orders.companyId, user.companyId))).for("update");
    if (!order || order.status !== "encerrado" || !order.activeClosureId) fail("Conferência não disponível", 404);
    const [existing] = await tx.select().from(financialEntries).where(eq(financialEntries.closureId, order.activeClosureId));
    if (existing) return { entry: existing, duplicated: true };
    const [closure] = await tx.select().from(closures).where(eq(closures.id, order.activeClosureId));
    if (!closure || !closure.active || closure.finalCents <= 0 || !["pendente", "recebida"].includes(order.billingStatus)) fail("Não há cobrança para importar");
    if (data.receivedCents > closure.finalCents) fail("Recebimento excede o valor da conferência; faça a conciliação dos reembolsos");
    if (data.receivedCents > 0 && !data.occurredAt) fail("Informe a data do recebimento comprovado");
    const [entry] = await tx.insert(financialEntries).values({ companyId: user.companyId, customerId: order.customerId, closureId: closure.id,
      direction: "receber", category: "reposicao", description: `Conferência histórica · pedido #${order.number}`,
      amountCents: closure.finalCents, dueDate: data.dueDate, createdBy: user.id }).returning();
    await tx.update(orders).set({ billingStatus: "pendente" }).where(eq(orders.id, order.id));
    if (data.receivedCents > 0) await recordSettlement(tx, user, { entryId: entry.id, amountCents: data.receivedCents,
      occurredAt: data.occurredAt, method: data.method, note: "Recebimento histórico informado e conferido pelo usuário", idempotencyKey: `historico:${closure.id}` });
    await audit(tx, user, "conferencia_importada", { orderId: order.id, previousStatus: order.billingStatus, entryId: entry.id, receivedCents: data.receivedCents });
    return { entry, duplicated: false };
  });
}

export async function commissionData(user: SessionUser) {
  const rows = await db.select({ commission: commissions, seller: users.name, contractNumber: rentalDocuments.number })
    .from(commissions).innerJoin(users, eq(users.id, commissions.sellerId))
    .innerJoin(rentalDocuments, eq(rentalDocuments.id, commissions.documentId))
    .where(eq(commissions.companyId, user.companyId)).orderBy(desc(commissions.createdAt));
  return { commissions: rows.map(r => ({ ...r.commission, seller: r.seller, contractNumber: r.contractNumber })) };
}
export async function payCommission(user: SessionUser, input: unknown) {
  const data = z.object({ id: uuid, method: settlementSchema.shape.method, idempotencyKey: z.string().min(16).max(120) }).parse(input);
  if (data.method === "pagbank") fail("Informe o método do pagamento manual");
  return db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [commission] = await tx.select().from(commissions).where(and(eq(commissions.id, data.id), eq(commissions.companyId, user.companyId))).for("update");
    if (!commission) fail("Comissão não encontrada", 404);
    if (commission.status === "paga") return { commission, duplicated: true };
    if (commission.status !== "pendente" || commission.amountCents <= 0) fail("Comissão indisponível para pagamento");
    const [entry] = await tx.insert(financialEntries).values({ companyId: user.companyId, direction: "pagar",
      description: `Comissão ${commission.id}`, category: "comissao", amountCents: commission.amountCents,
      documentId: commission.documentId, dueDate: localDay(user.timezone), createdBy: user.id }).returning();
    await recordSettlement(tx, user, { entryId: entry.id, amountCents: entry.amountCents, method: data.method, note: "Pagamento de comissão", idempotencyKey: data.idempotencyKey });
    const [updated] = await tx.update(commissions).set({ status: "paga", paidAt: new Date(), paidBy: user.id }).where(eq(commissions.id, commission.id)).returning();
    await audit(tx, user, "comissao_paga", { commissionId: commission.id, entryId: entry.id });
    return { commission: updated, duplicated: false };
  });
}
