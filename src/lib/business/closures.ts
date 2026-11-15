import { db } from "@/lib/db";
import { orders, orderItems, returns, returnItems, closures, billingEvents, auditLog, financialEntries, settlements } from "@/lib/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { lockCompany, localDay, assertNoOpenCheckout } from "@/lib/erp/common";
import { createConferenceCharge, creditReopenedCharges, priorConferenceReceipts, changeConferenceStock, restoreConferenceStock } from "@/lib/erp/conference";
import { recordSettlement } from "@/lib/erp/finance";
import { computeBalances, calculateClosing, applyAdjustment, buildSummaryText, buildWhatsAppUrl } from "@/lib/business/types";
import type { SessionUser } from "@/lib/auth/session";
import { AuthError } from "@/lib/auth/session";

export type CloseOrderInput = {
  orderId: string;
  /** Quantidade faltante confirmada explicitamente pelo gestor (soma dos itens). */
  confirmedMissingQty: number;
};

export async function loadOrderBalances(orderId: string) {
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const rets = await db.select().from(returns).where(eq(returns.orderId, orderId));
  const retIds = rets.map((r) => r.id);
  const rItems = retIds.length > 0 ? await db.select().from(returnItems).where(inArray(returnItems.returnId, retIds)) : [];
  return computeBalances(items, rItems);
}

export async function closeOrder(input: CloseOrderInput, user: SessionUser) {
  return db.transaction(async (tx) => {
    await lockCompany(tx, user.companyId);
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.companyId, user.companyId)))
      .for("update");
    if (!order) throw new AuthError("Pedido não encontrado", 404);
    if (order.status === "encerrado") throw new Error("Pedido já está encerrado");
    if (order.status !== "aberto") throw new Error("Confirme a saída antes de encerrar");

    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const rets = await tx.select().from(returns).where(eq(returns.orderId, order.id));
    const retIds = rets.map((r) => r.id);
    const rItems = retIds.length > 0 ? await tx.select().from(returnItems).where(inArray(returnItems.returnId, retIds)) : [];

    const balances = computeBalances(items, rItems);
    const calc = calculateClosing(balances);

    if (calc.missingQty !== input.confirmedMissingQty) {
      throw new Error(
        `Confirmação incorreta: o saldo em aberto é ${calc.missingQty}, não ${input.confirmedMissingQty}`,
      );
    }

    const finalCents = calc.suggestedCents;

    const [closure] = await tx
      .insert(closures)
      .values({
        orderId: order.id,
        companyId: order.companyId,
        closedBy: user.id,
        missingQty: calc.missingQty,
        damagedQty: calc.damagedQty,
        goodQty: calc.goodQty,
        suggestedCents: calc.suggestedCents,
        finalCents,
        itemsSnapshot: calc.perItem,
        active: true,
      })
      .returning();

    const charge = await createConferenceCharge(tx, user, order, closure);
    await changeConferenceStock(tx, user, closure.id, order.id, calc.perItem);
    await tx.update(orders).set({
      status: "encerrado",
      closedAt: closure.closedAt,
      closedBy: user.id,
      activeClosureId: closure.id,
      billingStatus: charge.billingStatus,
    }).where(eq(orders.id, order.id));

    if (charge.amountDue > 0) {
      await tx.insert(billingEvents).values({
        orderId: order.id,
        companyId: order.companyId,
        status: "pendente",
        amountCents: charge.amountDue,
        note: "Fechamento do pedido",
        createdBy: user.id,
      });
    }

    await tx.insert(auditLog).values({
      companyId: order.companyId,
      orderId: order.id,
      action: "pedido_encerrado",
      payload: { closureId: closure.id, suggestedCents: calc.suggestedCents, missingQty: calc.missingQty },
      createdBy: user.id,
    });

    return closure;
  });
}

export async function adjustCharge(input: {
  orderId: string;
  adjustmentCents: number;
  reason: string;
}, user: SessionUser) {
  if (!input.reason.trim()) throw new Error("Justificativa é obrigatória");
  if (!Number.isInteger(input.adjustmentCents) || input.adjustmentCents < 0) {
    throw new Error("Ajuste deve ser um inteiro não negativo em centavos");
  }

  return db.transaction(async (tx) => {
    await lockCompany(tx, user.companyId);
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.companyId, user.companyId)))
      .for("update");
    if (!order) throw new AuthError("Pedido não encontrado", 404);
    if (order.status !== "encerrado" || !order.activeClosureId) {
      throw new Error("Ajuste permitido apenas após o fechamento");
    }

    const [closure] = await tx
      .select()
      .from(closures)
      .where(eq(closures.id, order.activeClosureId))
      .for("update");
    if (!closure || !closure.active) throw new Error("Fechamento ativo não encontrado");
    if (order.billingStatus === "recebida" || order.billingStatus === "dispensada") {
      throw new AuthError("Ajuste indisponível: a cobrança já foi baixada", 400);
    }

    const finalCents = applyAdjustment(closure.suggestedCents, input.adjustmentCents);
    if (await priorConferenceReceipts(tx, order.id) > 0) {
      throw new AuthError("Ajuste com recebimentos anteriores exige reabertura e conciliação", 400);
    }

    await tx
      .update(closures)
      .set({
        adjustmentCents: input.adjustmentCents,
        adjustmentReason: input.reason.trim(),
        adjustedBy: user.id,
        adjustedAt: new Date(),
        finalCents,
      })
      .where(eq(closures.id, closure.id));

    const billingStatus = finalCents > 0 ? "pendente" : "sem_cobranca";
    const [entry] = await tx.select().from(financialEntries).where(eq(financialEntries.closureId, closure.id)).for("update");
    if (entry) {
      await assertNoOpenCheckout(tx, user.companyId, entry.id);
      const [{ paid }] = await tx.select({ paid: sql<number>`coalesce(sum(${settlements.amountCents}),0)::int` }).from(settlements).where(eq(settlements.entryId, entry.id));
      if (paid > 0 || entry.direction !== "receber") throw new AuthError("Ajuste com pagamento exige reabertura e conciliação", 400);
      await tx.update(financialEntries).set({ amountCents: finalCents, creditedCents: 0 }).where(eq(financialEntries.id, entry.id));
    } else if (finalCents > 0) {
      await tx.insert(financialEntries).values({ companyId: user.companyId, customerId: order.customerId,
        closureId: closure.id, direction: "receber", category: "reposicao", description: `Reposição · pedido #${order.number}`,
        amountCents: finalCents, dueDate: localDay(user.timezone), createdBy: user.id });
    }
    await tx.update(orders).set({ billingStatus }).where(eq(orders.id, order.id));
    if (order.billingStatus === "pendente" || order.billingStatus === "sem_cobranca") {
      await tx.insert(billingEvents).values({
        orderId: order.id,
        companyId: order.companyId,
        status: billingStatus,
        amountCents: finalCents,
        note: `Ajuste: ${input.reason.trim()}`,
        createdBy: user.id,
      });
    }

    await tx.insert(auditLog).values({
      companyId: order.companyId,
      orderId: order.id,
      action: "cobranca_ajustada",
      payload: { adjustmentCents: input.adjustmentCents, reason: input.reason, finalCents },
      createdBy: user.id,
    });

    return { ...closure, finalCents, adjustmentCents: input.adjustmentCents };
  });
}

export async function reopenOrder(input: { orderId: string; reason: string }, user: SessionUser) {
  if (!input.reason.trim()) throw new Error("Motivo da reabertura é obrigatório");

  return db.transaction(async (tx) => {
    await lockCompany(tx, user.companyId);
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.companyId, user.companyId)))
      .for("update");
    if (!order) throw new AuthError("Pedido não encontrado", 404);
    if (order.status !== "encerrado") throw new Error("Pedido não está encerrado");

    let priorReceivedCents: number | null = null;
    if (order.billingStatus === "recebida") {
      const [linked] = await tx.select({ id: financialEntries.id }).from(financialEntries).where(eq(financialEntries.closureId, order.activeClosureId!));
      if (!linked) throw new AuthError("Concilie a cobrança antiga no Financeiro antes de reabrir o pedido", 400);
      const receivedEvents = await tx
        .select()
        .from(billingEvents)
        .where(and(eq(billingEvents.orderId, order.id), eq(billingEvents.status, "recebida")));
      priorReceivedCents = receivedEvents.reduce((sum, e) => sum + (e.amountCents ?? 0), 0);
    }

    if (order.activeClosureId) {
      await creditReopenedCharges(tx, user, order.id);
      await restoreConferenceStock(tx, user, order.activeClosureId);
      await tx
        .update(closures)
        .set({ active: false, reopenedAt: new Date(), reopenedBy: user.id, reopenReason: input.reason.trim() })
        .where(eq(closures.id, order.activeClosureId));
    }

    const receipts = await priorConferenceReceipts(tx, order.id);
    if (receipts > 0) priorReceivedCents = receipts;
    await tx
      .update(orders)
      .set({ status: "aberto", closedAt: null, closedBy: null, activeClosureId: null })
      .where(eq(orders.id, order.id));

    await tx.insert(auditLog).values({
      companyId: order.companyId,
      orderId: order.id,
      action: "pedido_reaberto",
      payload: { reason: input.reason, priorReceivedCents },
      createdBy: user.id,
    });

    return { priorReceivedCents };
  });
}

export async function setBillingStatus(input: {
  orderId: string;
  status: "sem_cobranca" | "pendente" | "recebida" | "dispensada";
  note?: string;
}, user: SessionUser) {
  return db.transaction(async (tx) => {
    await lockCompany(tx, user.companyId);
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.companyId, user.companyId)))
      .for("update");
    if (!order) throw new AuthError("Pedido não encontrado", 404);
    if (order.status !== "encerrado" || !order.activeClosureId) {
      throw new AuthError("Cobrança permitida apenas após o fechamento", 400);
    }

    let amountCents: number | null = null;
    if (order.activeClosureId) {
      const [closure] = await tx.select().from(closures).where(eq(closures.id, order.activeClosureId));
      amountCents = closure?.finalCents ?? null;
    }
    if (amountCents === null) throw new AuthError("Fechamento ativo não encontrado", 400);
    if ((amountCents === 0 && input.status !== "sem_cobranca") || (amountCents > 0 && input.status === "sem_cobranca")) {
      throw new AuthError("Status de cobrança inválido para este valor", 400);
    }
    if (order.billingStatus === input.status) return { status: input.status };
    if (order.billingStatus === "recebida" || order.billingStatus === "dispensada") {
      throw new AuthError("Cobrança já baixada; alteração requer conciliação", 400);
    }
    const [entry] = await tx.select().from(financialEntries).where(eq(financialEntries.closureId, order.activeClosureId));
    if (!entry && amountCents > 0) throw new AuthError("Concilie a cobrança antiga no Financeiro antes de registrar a baixa", 400);
    if (entry && entry.direction === "receber") {
      await assertNoOpenCheckout(tx, user.companyId, entry.id);
      const [{ paid }] = await tx.select({ paid: sql<number>`coalesce(sum(${settlements.amountCents}),0)::int` }).from(settlements).where(eq(settlements.entryId, entry.id));
      const balance = entry.amountCents - entry.creditedCents - paid;
      if (input.status === "recebida" && balance > 0) {
        await recordSettlement(tx, user, { entryId: entry.id, amountCents: balance, method: "outro",
          note: input.note || "Baixa manual na conferência", idempotencyKey: `conference:${entry.id}` });
        return { status: input.status };
      }
      if (input.status === "dispensada" || input.status === "sem_cobranca") {
        if (paid > 0) throw new AuthError("Cobrança com recebimento exige conciliação", 400);
        await tx.update(financialEntries).set({ creditedCents: entry.amountCents, cancelReason: input.note || "Dispensa na conferência" }).where(eq(financialEntries.id, entry.id));
      }
    }

    await tx.update(orders).set({ billingStatus: input.status }).where(eq(orders.id, order.id));
    await tx.insert(billingEvents).values({
      orderId: order.id,
      companyId: order.companyId,
      status: input.status,
      amountCents,
      note: input.note ?? "",
      createdBy: user.id,
    });
    await tx.insert(auditLog).values({
      companyId: order.companyId,
      orderId: order.id,
      action: "cobranca_status",
      payload: { status: input.status, note: input.note ?? "" },
      createdBy: user.id,
    });
    return { status: input.status };
  });
}

export async function buildOrderSummary(orderId: string, user: SessionUser) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.companyId, user.companyId)));
  if (!order) throw new AuthError("Pedido não encontrado", 404);

  const balances = await loadOrderBalances(order.id);
  const calc = calculateClosing(balances);

  const [closure] = order.activeClosureId
    ? await db.select().from(closures).where(eq(closures.id, order.activeClosureId))
    : [];

  const suggestedCents = closure?.suggestedCents ?? calc.suggestedCents;
  const adjustmentCents = closure?.adjustmentCents ?? 0;
  const finalCents = closure?.finalCents ?? suggestedCents;

  const customer = await db
    .select()
    .from((await import("@/lib/db/schema")).customers)
    .where(eq((await import("@/lib/db/schema")).customers.id, order.customerId))
    .limit(1);

  const text = buildSummaryText({
    orderNumber: order.number,
    customerName: customer[0]?.name ?? "",
    eventName: order.eventName,
    items: calc.perItem,
    suggestedCents,
    adjustmentCents,
    adjustmentReason: closure?.adjustmentReason,
    finalCents,
  });

  return { text, whatsappUrl: buildWhatsAppUrl(text), suggestedCents, adjustmentCents, finalCents };
}
