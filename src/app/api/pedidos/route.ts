import { assertFeature } from "@/lib/saas/access";
import { createRentalOrder } from "@/lib/erp/orders";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { orders, customers } from "@/lib/db/schema";
import { eq, and, or, ilike, sql, desc } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const { user } = await requireSession();
    await assertFeature(user, "returns", "view");
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";

    let rows;
    if (q) {
      const pattern = `%${q}%`;
      rows = await db
        .select({
          id: orders.id,
          number: orders.number,
          status: orders.status,
          billingStatus: orders.billingStatus,
          eventName: orders.eventName,
          eventDate: orders.eventDate,
          returnDueDate: orders.returnDueDate,
          customerName: customers.name,
          closedAt: orders.closedAt,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .where(
          and(
            eq(orders.companyId, user.companyId),
            or(
              ilike(orders.eventName, pattern),
              ilike(customers.name, pattern),
              sql`CAST(orders.number AS text) LIKE ${pattern}`,
            ),
          ),
        )
        .orderBy(desc(orders.createdAt))
        .limit(100);
    } else {
      rows = await db
        .select({
          id: orders.id,
          number: orders.number,
          status: orders.status,
          billingStatus: orders.billingStatus,
          eventName: orders.eventName,
          eventDate: orders.eventDate,
          returnDueDate: orders.returnDueDate,
          customerName: customers.name,
          closedAt: orders.closedAt,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .where(eq(orders.companyId, user.companyId))
        .orderBy(desc(orders.createdAt))
        .limit(100);
    }
    return { orders: rows };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { user } = await requireSession();
    await assertFeature(user, "events", "view");
    return createRentalOrder(user, await req.json());
  });
}
