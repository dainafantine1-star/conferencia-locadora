import { db } from "@/lib/db";
import { orders, orderItems, returns, returnItems, closures, billingEvents, auditLog } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
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

    await tx.update(orders).set({
      status: "encerrado",
      closedAt: closure.closedAt,
      closedBy: user.id,
      activeClosureId: closure.id,
      billingStatus: finalCents > 0 ? "pendente" : "sem_cobranca",
    }).where(eq(orders.id, order.id));

    if (finalCents > 0) {
      await tx.insert(billingEvents).values({
        orderId: order.id,
        companyId: order.companyId,
        status: "pendente",
        amountCents: finalCents,
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

    const finalCents = applyAdjustment(closure.suggestedCents, input.adjustmentCents);

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

    // Atualiza valor pendente, se for o caso (sem estorno automático)
    if (order.billingStatus === "pendente") {
      await tx.insert(billingEvents).values({
        orderId: order.id,
        companyId: order.companyId,
        status: "pendente",
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
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.companyId, user.companyId)))
      .for("update");
    if (!order) throw new AuthError("Pedido não encontrado", 404);
    if (order.status !== "encerrado") throw new Error("Pedido não está encerrado");

    let priorReceivedCents: number | null = null;
    if (order.billingStatus === "recebida") {
      const receivedEvents = await tx
        .select()
        .from(billingEvents)
        .where(and(eq(billingEvents.orderId, order.id), eq(billingEvents.status, "recebida")));
      priorReceivedCents = receivedEvents.reduce((sum, e) => sum + (e.amountCents ?? 0), 0);
    }

    if (order.activeClosureId) {
      await tx
        .update(closures)
        .set({ active: false, reopenedAt: new Date(), reopenedBy: user.id, reopenReason: input.reason.trim() })
        .where(eq(closures.id, order.activeClosureId));
    }

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
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.companyId, user.companyId)))
      .for("update");
    if (!order) throw new AuthError("Pedido não encontrado", 404);

    let amountCents: number | null = null;
    if (order.activeClosureId) {
      const [closure] = await tx.select().from(closures).where(eq(closures.id, order.activeClosureId));
      amountCents = closure?.finalCents ?? null;
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
