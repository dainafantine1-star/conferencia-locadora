import { z } from "zod";
import { db } from "@/lib/db";
import { catalogItems, orders, orderItems, returnItems, stockMovements } from "@/lib/db/schema";
import { and, eq, sql, inArray, desc } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { day, uuid, fail, nextDay, localDay, audit, type Tx } from "./common";

export type Reservation = { start: string; end: string; qty: number };
export function maximumReserved(reservations: Reservation[], start: string, end: string) {
  const events = new Map<string, number>();
  for (const r of reservations) {
    if (r.end < start || r.start > end || r.qty <= 0) continue;
    const from = r.start > start ? r.start : start;
    const until = nextDay(r.end < end ? r.end : end);
    events.set(from, (events.get(from) ?? 0) + r.qty);
    events.set(until, (events.get(until) ?? 0) - r.qty);
  }
  let running = 0, peak = 0;
  for (const [, delta] of [...events].sort(([a], [b]) => a.localeCompare(b))) { running += delta; peak = Math.max(peak, running); }
  return peak;
}

export async function periodAvailability(user: SessionUser, start: string, end: string, tx?: Tx, excludeOrderId?: string) {
  day.parse(start); day.parse(end);
  if (end < start) fail("O fim do período não pode ser anterior ao início");
  const executor = tx ?? db;
  const items = await executor.select().from(catalogItems).where(and(eq(catalogItems.companyId, user.companyId), eq(catalogItems.active, true)));
  const booked = await executor.select({
    catalogId: orderItems.catalogItemId, planned: orderItems.qtyPlanned, delivered: orderItems.qtyDelivered,
    start: orders.eventDate, end: orders.returnDueDate, status: orders.status, orderId: orders.id,
    itemId: orderItems.id,
  }).from(orderItems).innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.companyId, user.companyId), inArray(orders.status, ["rascunho", "aberto"])));
  const ids = booked.map(b => b.itemId);
  const returned = ids.length ? await executor.select({ id: returnItems.orderItemId,
    qty: sql<number>`sum(${returnItems.qtyGood} + ${returnItems.qtyDamaged})::int`,
  }).from(returnItems).where(inArray(returnItems.orderItemId, ids)).groupBy(returnItems.orderItemId) : [];
  const byItem = new Map(returned.map(r => [r.id, r.qty]));
  const today = localDay(user.timezone);
  return items.map(item => {
    const reservations: Reservation[] = booked.filter(b => b.catalogId === item.id && b.orderId !== excludeOrderId).map(b => {
      const qty = b.delivered === null ? b.planned : Math.max(0, b.delivered - (byItem.get(b.itemId) ?? 0));
      // Unreturned overdue items cannot be promised for a future period.
      return { start: b.delivered !== null && qty > 0 && b.start > today ? today : b.start, end: b.status === "aberto" && b.end < today && qty > 0 ? (end > today ? end : today) : b.end, qty };
    });
    const reserved = maximumReserved(reservations, start, end);
    return { ...item, reserved, available: item.stockQty === null ? null : Math.max(0, item.stockQty - item.unavailableQty - reserved) };
  });
}

const movementSchema = z.object({ catalogItemId: uuid,
  kind: z.enum(["entrada", "saida", "manutencao", "reparo", "inventario"]),
  quantity: z.number().int().min(0).max(1000000), reason: z.string().trim().min(3).max(2000),
}).refine(d => d.kind === "inventario" || d.quantity > 0, "Informe uma quantidade maior que zero");
export async function moveStock(user: SessionUser, input: unknown) {
  const data = movementSchema.parse(input);
  return db.transaction(async tx => {
    const [item] = await tx.select().from(catalogItems).where(and(eq(catalogItems.id, data.catalogItemId), eq(catalogItems.companyId, user.companyId))).for("update");
    if (!item) fail("Item não encontrado", 404);
    if (item.stockQty === null && data.kind !== "inventario") fail("Informe o estoque inicial antes de registrar movimentações");
    let delta = 0, unavailableDelta = 0;
    if (data.kind === "entrada") delta = data.quantity;
    if (data.kind === "saida") delta = -data.quantity;
    if (data.kind === "inventario") delta = data.quantity - (item.stockQty ?? 0);
    if (data.kind === "manutencao") unavailableDelta = data.quantity;
    if (data.kind === "reparo") unavailableDelta = -data.quantity;
    const total = (item.stockQty ?? 0) + delta;
    const unavailable = item.unavailableQty + unavailableDelta;
    if (total < 0 || unavailable < 0 || unavailable > total) fail("Movimentação excede o estoque ou as unidades indisponíveis");
    const [updated] = await tx.update(catalogItems).set({ stockQty: total, unavailableQty: unavailable }).where(eq(catalogItems.id, item.id)).returning();
    const [movement] = await tx.insert(stockMovements).values({ companyId: user.companyId, catalogItemId: item.id,
      kind: data.kind, delta, unavailableDelta, reason: data.reason, createdBy: user.id }).returning();
    await audit(tx, user, "estoque_movimentado", { movementId: movement.id });
    return { item: updated, movement };
  });
}
export async function inventoryData(user: SessionUser, search: URLSearchParams) {
  const start = search.get("start") ?? localDay(user.timezone);
  const end = search.get("end") ?? start;
  const [items, movements] = await Promise.all([
    periodAvailability(user, start, end),
    db.select().from(stockMovements).where(eq(stockMovements.companyId, user.companyId)).orderBy(desc(stockMovements.createdAt)).limit(200),
  ]);
  return { items, movements, start, end };
}
