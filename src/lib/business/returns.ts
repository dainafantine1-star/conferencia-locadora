import { db } from "@/lib/db";
import {
  orders,
  orderItems,
  returns,
  returnItems,
  auditLog,
} from "@/lib/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  computeBalances,
  validateReturnQuantities,
  type ItemBalance,
} from "@/lib/business/types";
import type { SessionUser } from "@/lib/auth/session";
import { AuthError } from "@/lib/auth/session";

export type ReturnLineInput = {
  orderItemId: string;
  qtyGood: number;
  qtyDamaged: number;
};

export type RegisterReturnInput = {
  orderId: string;
  lines: ReturnLineInput[];
  notes?: string;
  idempotencyKey?: string;
};

export type RegisterReturnResult = {
  returnId: string;
  duplicated: boolean;
  balances: ItemBalance[];
};

/**
 * Registra uma devolução com transação e trava por item (SELECT ... FOR UPDATE)
 * para que duas submissões simultâneas não excedam o saldo.
 * Idempotência: a mesma chave não duplica a devolução.
 */
export async function registerReturn(
  input: RegisterReturnInput,
  user: SessionUser,
): Promise<RegisterReturnResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.companyId, user.companyId)))
      .for("update");
    if (!order) throw new AuthError("Pedido não encontrado", 404);
    if (order.status === "encerrado") {
      throw new Error("Pedido encerrado: novas devoluções não são permitidas");
    }
    if (order.status !== "aberto") {
      throw new Error("Pedido ainda não teve a saída confirmada");
    }

    if (input.idempotencyKey) {
      const [existing] = await tx
        .select({ id: returns.id })
        .from(returns)
        .where(eq(returns.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing) {
        const balances = await loadBalances(tx, order.id);
        return { returnId: existing.id, duplicated: true, balances };
      }
    }

    const itemIds = input.lines.map((l) => l.orderItemId);
    if (itemIds.length === 0) {
      throw new Error("Informe ao menos um item");
    }

    const items = await tx
      .select()
      .from(orderItems)
      .where(and(inArray(orderItems.id, itemIds), eq(orderItems.orderId, order.id)))
      .for("update");
    if (items.length !== itemIds.length) {
      throw new Error("Item inválido para este pedido");
    }

    const allReturnItems = await tx
      .select()
      .from(returnItems)
      .innerJoin(returns, eq(returnItems.returnId, returns.id))
      .where(eq(returns.orderId, order.id));

    const priorByItem = new Map<string, { good: number; damaged: number }>();
    for (const ri of allReturnItems) {
      const key = ri.return_items.orderItemId;
      const prev = priorByItem.get(key) ?? { good: 0, damaged: 0 };
      prev.good += ri.return_items.qtyGood;
      prev.damaged += ri.return_items.qtyDamaged;
      priorByItem.set(key, prev);
    }

    const planned = input.lines.map((line) => {
      const item = items.find((i) => i.id === line.orderItemId)!;
      const prior = priorByItem.get(line.orderItemId) ?? { good: 0, damaged: 0 };
      const delivered = item.qtyDelivered ?? 0;
      const open = delivered - prior.good - prior.damaged;
      return {
        orderItemId: line.orderItemId,
        qtyGood: line.qtyGood,
        qtyDamaged: line.qtyDamaged,
        open,
      };
    });

    const validationError = validateReturnQuantities(planned);
    if (validationError) throw new Error(validationError);

    const [ret] = await tx
      .insert(returns)
      .values({
        orderId: order.id,
        companyId: order.companyId,
        notes: input.notes ?? "",
        createdBy: user.id,
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .returning();

    if (input.lines.length > 0) {
      await tx.insert(returnItems).values(
        input.lines.map((l) => ({
          returnId: ret.id,
          orderItemId: l.orderItemId,
          qtyGood: l.qtyGood,
          qtyDamaged: l.qtyDamaged,
        })),
      );
    }

    await tx.insert(auditLog).values({
      companyId: order.companyId,
      orderId: order.id,
      action: "retorno_registrado",
      payload: {
        returnId: ret.id,
        lines: input.lines,
        notes: input.notes ?? "",
      },
      createdBy: user.id,
    });

    const balances = await loadBalances(tx, order.id);
    return { returnId: ret.id, duplicated: false, balances };
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function loadBalances(tx: Tx, orderId: string): Promise<ItemBalance[]> {
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const rets = await tx.select().from(returns).where(eq(returns.orderId, orderId));
  const retIds = rets.map((r) => r.id);
  const rItems =
    retIds.length > 0
      ? await tx.select().from(returnItems).where(inArray(returnItems.returnId, retIds))
      : [];
  return computeBalances(items, rItems);
}
