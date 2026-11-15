import { and, eq, sql, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { financialEntries, settlements, closures, catalogItems, stockMovements, orderItems, orders } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { type Tx, fail, localDay, audit, assertNoOpenCheckout } from "./common";

export async function conferenceFinanceTotals(user: SessionUser) {
  const [active, entries] = await Promise.all([
    db.select({ id: closures.id, finalCents: closures.finalCents, suggestedCents: closures.suggestedCents, status: orders.billingStatus })
      .from(orders).innerJoin(closures, eq(closures.id, orders.activeClosureId))
      .where(and(eq(orders.companyId, user.companyId), eq(closures.active, true))),
    db.select({ entry: financialEntries, paidCents: sql<number>`coalesce(sum(${settlements.amountCents}),0)::float8` })
      .from(financialEntries).leftJoin(settlements, eq(settlements.entryId, financialEntries.id))
      .where(and(eq(financialEntries.companyId, user.companyId), isNotNull(financialEntries.closureId))).groupBy(financialEntries.id),
  ]);
  const linked = new Set(entries.map(r => r.entry.closureId));
  const totals = { pendente: 0, recebida: 0, dispensada: 0, sugerido: 0 };
  for (const { entry, paidCents } of entries) {
    totals.recebida += entry.direction === "receber" ? paidCents : -paidCents;
    if (entry.direction === "receber" && !entry.cancelledAt) totals.pendente += Math.max(0, entry.amountCents - entry.creditedCents - paidCents);
  }
  for (const closure of active) {
    totals.sugerido += closure.suggestedCents;
    if (closure.status === "dispensada") totals.dispensada += closure.finalCents;
    // Preserve recorded legacy amounts until the operator explicitly reconciles them.
    if (!linked.has(closure.id)) {
      if (closure.status === "pendente") totals.pendente += closure.finalCents;
      if (closure.status === "recebida") totals.recebida += closure.finalCents;
    }
  }
  return totals;
}

export async function priorConferenceReceipts(tx: Tx, orderId: string) {
  const [{ total }] = await tx.select({ total: sql<number>`coalesce(sum(case when ${financialEntries.direction} = 'receber' then ${settlements.amountCents} else -${settlements.amountCents} end),0)::float8` })
    .from(settlements).innerJoin(financialEntries, eq(financialEntries.id, settlements.entryId))
    .innerJoin(closures, eq(closures.id, financialEntries.closureId)).where(eq(closures.orderId, orderId));
  return total;
}
export async function createConferenceCharge(tx: Tx, user: SessionUser, order: { id: string; number: number; customerId: string }, closure: { id: string; finalCents: number }) {
  const prior = await priorConferenceReceipts(tx, order.id);
  const difference = closure.finalCents - prior;
  if (difference !== 0) await tx.insert(financialEntries).values({ companyId: user.companyId, customerId: order.customerId,
    closureId: closure.id, direction: difference > 0 ? "receber" : "pagar",
    category: difference > 0 ? "reposicao" : "reembolso",
    description: `${difference > 0 ? "Reposição" : "Reembolso por revisão"} · pedido #${order.number}`,
    amountCents: Math.abs(difference), dueDate: localDay(user.timezone), createdBy: user.id });
  return { billingStatus: (closure.finalCents === 0 ? "sem_cobranca" : difference > 0 ? "pendente" : "recebida") as "sem_cobranca" | "pendente" | "recebida", amountDue: Math.max(0, difference), refundDue: Math.max(0, -difference) };
}
export async function creditReopenedCharges(tx: Tx, user: SessionUser, orderId: string) {
  const rows = await tx.select({ entry: financialEntries }).from(financialEntries).innerJoin(closures, eq(closures.id, financialEntries.closureId))
    .where(eq(closures.orderId, orderId));
  for (const { entry } of rows) {
    await assertNoOpenCheckout(tx, user.companyId, entry.id);
    const [{ paid }] = await tx.select({ paid: sql<number>`coalesce(sum(${settlements.amountCents}),0)::float8` }).from(settlements).where(eq(settlements.entryId, entry.id));
    const unpaid = entry.amountCents - entry.creditedCents - paid;
    if (unpaid > 0 && !entry.cancelledAt) {
      await tx.update(financialEntries).set({ creditedCents: entry.creditedCents + unpaid, cancelReason: "Saldo substituído após reabertura do pedido" }).where(eq(financialEntries.id, entry.id));
      await audit(tx, user, "saldo_reabertura_creditado", { entryId: entry.id, creditedCents: unpaid }, orderId);
    }
  }
}
export async function changeConferenceStock(tx: Tx, user: SessionUser, closureId: string, orderId: string, losses: { orderItemId: string; missingQty: number }[]) {
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const quantities = new Map<string, number>();
  for (const loss of losses) {
    const item = items.find(i => i.id === loss.orderItemId);
    if (item?.catalogItemId && loss.missingQty > 0) quantities.set(item.catalogItemId, (quantities.get(item.catalogItemId) ?? 0) + loss.missingQty);
  }
  for (const [id, qty] of [...quantities].sort(([a], [b]) => a.localeCompare(b))) {
    const [item] = await tx.select().from(catalogItems).where(and(eq(catalogItems.id, id), eq(catalogItems.companyId, user.companyId))).for("update");
    if (!item || item.stockQty === null) continue; // Unknown inventory remains unknown; no invented balance.
    if (item.stockQty - qty < item.unavailableQty) fail("O estoque cadastrado não comporta as faltas. Confira o inventário antes de fechar");
    await tx.update(catalogItems).set({ stockQty: item.stockQty - qty }).where(eq(catalogItems.id, id));
    await tx.insert(stockMovements).values({ companyId: user.companyId, catalogItemId: id, kind: "perda_fechamento",
      delta: -qty, reason: "Falta confirmada no fechamento", referenceId: closureId, createdBy: user.id });
  }
}
export async function restoreConferenceStock(tx: Tx, user: SessionUser, closureId: string) {
  const movements = await tx.select().from(stockMovements).where(and(eq(stockMovements.referenceId, closureId), eq(stockMovements.kind, "perda_fechamento")));
  for (const movement of movements) {
    await tx.update(catalogItems).set({ stockQty: sql`${catalogItems.stockQty} - ${movement.delta}` }).where(and(eq(catalogItems.id, movement.catalogItemId), eq(catalogItems.companyId, user.companyId)));
    await tx.insert(stockMovements).values({ companyId: user.companyId, catalogItemId: movement.catalogItemId, kind: "reabertura",
      delta: -movement.delta, reason: "Estoque restaurado para nova conferência", referenceId: closureId, createdBy: user.id });
  }
}
