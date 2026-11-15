import { z } from "zod";
import { and, eq, gte, lte, ne, or, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, customers, rentalDocuments, holidays, agendaSlots } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { brazilianDates, type CalendarDate } from "./dates";

export async function calendarData(user: SessionUser, query: URLSearchParams) {
  const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: user.timezone }).format(new Date());
  const year = z.coerce.number().int().min(1900).max(2199).parse(query.get("year") ?? localToday.slice(0, 4));
  const month = z.coerce.number().int().min(1).max(12).parse(query.get("month") ?? localToday.slice(5, 7));
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${start.slice(0, 8)}${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
  const company = user.companyId;
  const [rentalEvents, quotes, localDates, slots] = await Promise.all([
    db.select({ id: orders.id, number: orders.number, title: orders.eventName, start: orders.eventDate, due: orders.returnDueDate, status: orders.status, billing: orders.billingStatus, customer: customers.name })
      .from(orders).innerJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.companyId, company)))
      .where(and(eq(orders.companyId, company), ne(orders.status, "cancelado"), or(and(gte(orders.eventDate, start), lte(orders.eventDate, end)), and(gte(orders.returnDueDate, start), lte(orders.returnDueDate, end)))))
      .orderBy(asc(orders.eventDate)),
    user.role === "gestor" || user.permissions?.includes("comercial") ? db.select({ id: rentalDocuments.id, number: rentalDocuments.number, title: rentalDocuments.eventName, start: rentalDocuments.eventDate, due: rentalDocuments.returnDueDate, status: rentalDocuments.status, customer: customers.name })
      .from(rentalDocuments).innerJoin(customers, and(eq(customers.id, rentalDocuments.customerId), eq(customers.companyId, company)))
      .where(and(eq(rentalDocuments.companyId, company), eq(rentalDocuments.kind, "orcamento"), ne(rentalDocuments.status, "cancelado"), ne(rentalDocuments.status, "contratado"), gte(rentalDocuments.eventDate, start), lte(rentalDocuments.eventDate, end))).orderBy(asc(rentalDocuments.eventDate)) : [],
    db.select().from(holidays).where(and(eq(holidays.companyId, company), gte(holidays.day, start), lte(holidays.day, end))),
    db.select().from(agendaSlots).where(and(eq(agendaSlots.companyId, company), gte(agendaSlots.day, start), lte(agendaSlots.day, end))),
  ]);
  const dates: CalendarDate[] = brazilianDates(year).filter(d => d.day >= start && d.day <= end);
  for (const row of localDates) {
    // Imported national dates enrich the display without duplicating the same date/name.
    if (!dates.some(d => d.day === row.day && d.name.localeCompare(row.name, "pt-BR", { sensitivity: "base" }) === 0)) dates.push({ id: row.id, day: row.day, name: row.name, kind: "local", source: row.source.startsWith("https://") ? row.source : undefined, detail: row.source === "manual" ? "Data cadastrada pela locadora." : "Data importada pela locadora; confira a abrangência local." });
  }
  return { year, month, today: localToday, dates, slots, events: [
    ...rentalEvents.map(e => ({ ...e, kind: "evento" as const, href: `/pedidos/${e.id}` })),
    ...quotes.map(e => ({ ...e, billing: "", kind: "orcamento" as const, href: `/gestao/comercial?documento=${e.id}` })),
  ] };
}
