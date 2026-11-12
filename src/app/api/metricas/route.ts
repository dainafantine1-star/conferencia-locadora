import { db } from "@/lib/db";
import {
  orders,
  customers,
  closures,
  returns,
  orderItems,
  returnItems,
} from "@/lib/db/schema";
import { eq, and, sql, desc, gte, lte } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";

function localDateInTz(tz: string, d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export async function GET() {
  return handle(async () => {
    const { user } = await requireSession();
    const tz = user.timezone;
    const today = localDateInTz(tz);
    const since = daysAgo(29);
    const sinceStr = localDateInTz(tz, since);

    // --- Devoluções por dia (últimos 30 dias) ---
    const retRows = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', returns.occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
        units: sql<number>`coalesce(sum(return_items.qty_good + return_items.qty_damaged), 0)::int`,
      })
      .from(returns)
      .leftJoin(returnItems, eq(returnItems.returnId, returns.id))
      .where(and(eq(returns.companyId, user.companyId), gte(returns.occurredAt, since)))
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    // Preenche dias vazios
    const retByDay = new Map(retRows.map((r) => [r.day.slice(0, 10), r]));
    const returnsSeries: { day: string; devolucoes: number; unidades: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const day = localDateInTz(tz, new Date(Date.now() - i * 86400000));
      const row = retByDay.get(day);
      returnsSeries.push({
        day: day.slice(5), // MM-DD
        devolucoes: row?.count ?? 0,
        unidades: row?.units ?? 0,
      });
    }

    // --- Pedidos criados por semana (últimas 8 semanas) ---
    const weekRows = await db
      .select({
        week: sql<string>`to_char(date_trunc('week', orders.created_at), 'IYYY-IW')`,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(and(eq(orders.companyId, user.companyId), gte(orders.createdAt, daysAgo(56))))
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    const weeksSeries = weekRows.map((r) => ({
      week: r.week.slice(-2) === "" ? r.week : `S${r.week.split("-")[1]}`,
      pedidos: r.count,
    }));

    // --- Status dos pedidos (donut) ---
    const statusRows = await db
      .select({
        status: orders.status,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(eq(orders.companyId, user.companyId))
      .groupBy(orders.status);

    // --- Cobranças (donut) ---
    const billingRows = await db
      .select({
        status: orders.billingStatus,
        count: sql<number>`count(*)::int`,
        cents: sql<number>`coalesce(sum(closures.final_cents), 0)::int`,
      })
      .from(orders)
      .leftJoin(closures, eq(closures.id, orders.activeClosureId))
      .where(eq(orders.companyId, user.companyId))
      .groupBy(orders.billingStatus);

    // --- Calendário: pedidos agrupados por data de evento (mês atual ±) ---
    const calOrders = await db
      .select({
        id: orders.id,
        number: orders.number,
        eventName: orders.eventName,
        eventDate: orders.eventDate,
        returnDueDate: orders.returnDueDate,
        status: orders.status,
        billingStatus: orders.billingStatus,
        customerName: customers.name,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(eq(orders.companyId, user.companyId))
      .orderBy(orders.eventDate)
      .limit(300);

    // --- KPIs ---
    const kpiRows = await db
      .select({
        total: sql<number>`count(*)::int`,
        abertos: sql<number>`count(*) filter (where status = 'aberto')::int`,
        encerrados: sql<number>`count(*) filter (where status = 'encerrado')::int`,
        atrasados: sql<number>`count(*) filter (where status = 'aberto' and return_due_date < ${today})::int`,
        hoje: sql<number>`count(*) filter (where status = 'aberto' and return_due_date = ${today})::int`,
      })
      .from(orders)
      .where(eq(orders.companyId, user.companyId));

    const receitaRows = await db
      .select({
        pendente: sql<number>`coalesce(sum(closures.final_cents) filter (where orders.billing_status = 'pendente'), 0)::int`,
        recebida: sql<number>`coalesce(sum(closures.final_cents) filter (where orders.billing_status = 'recebida'), 0)::int`,
        dispensada: sql<number>`coalesce(sum(closures.final_cents) filter (where orders.billing_status = 'dispensada'), 0)::int`,
        sugerido: sql<number>`coalesce(sum(closures.suggested_cents), 0)::int`,
      })
      .from(orders)
      .innerJoin(closures, eq(closures.id, orders.activeClosureId))
      .where(and(eq(orders.companyId, user.companyId), eq(closures.active, true)));

    const itemStats = await db
      .select({
        name: orderItems.name,
        delivered: sql<number>`coalesce(sum(order_items.qty_delivered), 0)::int`,
        returned: sql<number>`coalesce(sum(return_items.qty_good + return_items.qty_damaged), 0)::int`,
        damaged: sql<number>`coalesce(sum(return_items.qty_damaged), 0)::int`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .leftJoin(
        returnItems,
        sql`return_items.order_item_id = order_items.id`,
      )
      .where(eq(orders.companyId, user.companyId))
      .groupBy(orderItems.name)
      .orderBy(desc(sql`coalesce(sum(order_items.qty_delivered), 0)`))
      .limit(8);

    return {
      today,
      kpi: kpiRows[0] ?? { total: 0, abertos: 0, encerrados: 0, atrasados: 0, hoje: 0 },
      revenue: receitaRows[0] ?? { pendente: 0, recebida: 0, dispensada: 0, sugerido: 0 },
      returnsSeries,
      weeksSeries,
      statusSeries: statusRows.map((r) => ({
        name:
          r.status === "aberto" ? "Em aberto" : r.status === "encerrado" ? "Encerrados" : "Rascunhos",
        value: r.count,
      })),
      billingSeries: billingRows.map((r) => ({
        name:
          r.status === "pendente"
            ? "Pendente"
            : r.status === "recebida"
              ? "Recebida"
              : r.status === "dispensada"
                ? "Dispensada"
                : "Sem cobrança",
        value: r.count,
        cents: r.cents,
      })),
      calendar: calOrders.map((o) => ({
        id: o.id,
        number: o.number,
        title: o.eventName,
        customer: o.customerName,
        start: o.eventDate,
        due: o.returnDueDate,
        status: o.status,
        billing: o.billingStatus,
      })),
      topItems: itemStats.map((s) => ({
        name: s.name,
        entregues: s.delivered,
        devolvidos: Math.min(s.returned, s.delivered),
        avariados: s.damaged,
      })),
    };
  });
}
