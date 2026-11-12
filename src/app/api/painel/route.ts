import { db } from "@/lib/db";
import { orders, customers, closures, billingEvents } from "@/lib/db/schema";
import { eq, and, lt, gte, sql, desc } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";

function localDateInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET() {
  return handle(async () => {
    const { user } = await requireSession();
    const today = localDateInTz(user.timezone);

    const openOrders = await db
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
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(orders.companyId, user.companyId), eq(orders.status, "aberto")))
      .orderBy(orders.returnDueDate);

    const dueToday = openOrders.filter((o) => o.returnDueDate === today);
    const overdue = openOrders.filter((o) => o.returnDueDate < today);
    // "em conferência": aberto com previsão futura (ainda em andamento)
    const inProgress = openOrders.filter((o) => o.returnDueDate > today);

    const pendingBilling = await db
      .select({
        id: orders.id,
        number: orders.number,
        eventName: orders.eventName,
        customerName: customers.name,
        billingStatus: orders.billingStatus,
        finalCents: closures.finalCents,
        closedAt: orders.closedAt,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(closures, eq(closures.id, orders.activeClosureId))
      .where(
        and(
          eq(orders.companyId, user.companyId),
          eq(orders.billingStatus, "pendente"),
        ),
      )
      .orderBy(desc(orders.closedAt))
      .limit(50);

    const recentClosed = await db
      .select({
        id: orders.id,
        number: orders.number,
        eventName: orders.eventName,
        customerName: customers.name,
        closedAt: orders.closedAt,
        finalCents: closures.finalCents,
        billingStatus: orders.billingStatus,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(closures, eq(closures.id, orders.activeClosureId))
      .where(and(eq(orders.companyId, user.companyId), eq(orders.status, "encerrado")))
      .orderBy(desc(orders.closedAt))
      .limit(10);

    return {
      today,
      dueToday,
      overdue,
      inProgress,
      pendingBilling,
      recentClosed,
      counts: {
        dueToday: dueToday.length,
        overdue: overdue.length,
        inProgress: inProgress.length,
        pendingBilling: pendingBilling.length,
      },
    };
  });
}
