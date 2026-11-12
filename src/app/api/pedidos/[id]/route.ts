import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  orders,
  orderItems,
  customers,
  returns,
  returnItems,
  closures,
  billingEvents,
  attachments,
} from "@/lib/db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { requireSession, assertOrderAccess, AuthError } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";
import { computeBalances, calculateClosing } from "@/lib/business/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { user } = await requireSession();
    const { id } = await params;
    const order = await assertOrderAccess(id, user);

    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, order.customerId));

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))
      .orderBy(orderItems.position);

    const orderReturns = await db
      .select()
      .from(returns)
      .where(eq(returns.orderId, order.id))
      .orderBy(returns.occurredAt);

    const returnIds = orderReturns.map((r) => r.id);
    const rItems =
      returnIds.length > 0
        ? await db.select().from(returnItems).where(inArray(returnItems.returnId, returnIds))
        : [];

    const atts =
      returnIds.length > 0
        ? await db.select().from(attachments).where(inArray(attachments.returnId, returnIds))
        : [];

    const balances = computeBalances(items, rItems);
    const calc = calculateClosing(balances);

    const closure = order.activeClosureId
      ? (
          await db
            .select()
            .from(closures)
            .where(eq(closures.id, order.activeClosureId))
        )[0]
      : null;

    const allClosures = await db
      .select()
      .from(closures)
      .where(eq(closures.orderId, order.id))
      .orderBy(desc(closures.closedAt));

    const billing = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.orderId, order.id))
      .orderBy(desc(billingEvents.createdAt));

    return {
      order,
      customer,
      items,
      balances,
      closing: calc,
      returns: orderReturns.map((r) => ({
        ...r,
        items: rItems.filter((ri) => ri.returnId === r.id),
        attachments: atts.filter((a) => a.returnId === r.id),
      })),
      closure,
      closuresHistory: allClosures,
      billingEvents: billing,
      totals: {
        goodQty: calc.goodQty,
        damagedQty: calc.damagedQty,
        openQty: calc.missingQty,
        suggestedCents: calc.suggestedCents,
      },
    };
  });
}
