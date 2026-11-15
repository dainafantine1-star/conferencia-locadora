import { assertFeature } from "@/lib/saas/access";
import { db } from "@/lib/db";
import { orders, rentalDocuments, settlements, financialEntries } from "@/lib/db/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { financeData, commissionData } from "./finance";
import { inventoryData } from "./inventory";
import { day, localDay, fail } from "./common";

export async function reportData(user: SessionUser, query: URLSearchParams) {
  await assertFeature(user, "reports", "financial");
  const end = day.parse(query.get("end") ?? localDay(user.timezone));
  const start = day.parse(query.get("start") ?? `${end.slice(0, 7)}-01`);
  if (start > end) fail("Período inválido");
  const [finance, inventory, commission, sales, cash, orderCounts] = await Promise.all([
    financeData(user, new URLSearchParams({ start, end })),
    inventoryData(user, new URLSearchParams({ start, end })), commissionData(user),
    db.select({ id: rentalDocuments.id, number: rentalDocuments.number, status: rentalDocuments.status, eventName: rentalDocuments.eventName,
      eventDate: rentalDocuments.eventDate, totalCents: rentalDocuments.totalCents }).from(rentalDocuments)
      .where(and(eq(rentalDocuments.companyId, user.companyId), eq(rentalDocuments.kind, "contrato"), gte(rentalDocuments.eventDate, start), lte(rentalDocuments.eventDate, end))),
    db.select({ day: sql<string>`to_char(${settlements.occurredAt} at time zone ${user.timezone}, 'YYYY-MM-DD')`,
      direction: financialEntries.direction, category: financialEntries.category, amountCents: sql<number>`sum(${settlements.amountCents})::float8` })
      .from(settlements).innerJoin(financialEntries, eq(financialEntries.id, settlements.entryId))
      .where(and(eq(settlements.companyId, user.companyId), sql`(${settlements.occurredAt} at time zone ${user.timezone})::date >= ${start}::date`,
        sql`(${settlements.occurredAt} at time zone ${user.timezone})::date <= ${end}::date`))
      .groupBy(sql`1`, financialEntries.direction, financialEntries.category),
    db.select({ status: orders.status, count: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.companyId, user.companyId), gte(orders.eventDate, start), lte(orders.eventDate, end))).groupBy(orders.status),
  ]);
  const received = cash.filter(r => r.direction === "receber").reduce((a, r) => a + r.amountCents, 0);
  const paid = cash.filter(r => r.direction === "pagar").reduce((a, r) => a + r.amountCents, 0);
  return { start, end, entries: finance.entries, inventory: inventory.items, commissions: commission.commissions,
    sales, cash, orderCounts, totals: { ...finance.totals, received, paid, net: received - paid,
      contracted: sales.filter(s => s.status !== "cancelado").reduce((a, r) => a + r.totalCents, 0) } };
}
