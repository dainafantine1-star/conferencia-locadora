import type { SessionUser } from "@/lib/auth/session";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, orderItems, customers, catalogItems, companies } from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { periodAvailability } from "@/lib/erp/inventory";
import { fail } from "@/lib/erp/common";

const createSchema = z.object({
  customerId: z.string().uuid(),
  eventName: z.string().min(1, "Informe o evento"),
  eventDate: z.iso.date("Data do evento inválida"),
  returnDueDate: z.iso.date("Data de devolução inválida"),
  notes: z.string().optional().default(""),
  items: z
    .array(
      z.object({
        catalogItemId: z.string().uuid().nullable().optional(),
        name: z.string().min(1),
        unit: z.string().min(1),
        qtyPlanned: z.number().int().positive(),
      }),
    )
    .min(1, "Adicione ao menos um item"),
}).refine((body) => body.returnDueDate >= body.eventDate, {
  message: "A devolução não pode ser anterior ao evento", path: ["returnDueDate"],
});


export async function createRentalOrder(user: SessionUser, input: unknown) {
    const body = createSchema.parse(input);

    const [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, body.customerId), eq(customers.companyId, user.companyId)));
    if (!customer) throw new Error("Cliente não encontrado");

    const order = await db.transaction(async (tx) => {
      // Serialize numbering within the company, including simultaneous requests.
      await tx.select({ id: companies.id }).from(companies)
        .where(eq(companies.id, user.companyId)).for("update");
      const catalogIds = [...new Set(body.items.flatMap((item) => item.catalogItemId ? [item.catalogItemId] : []))];
      if (catalogIds.length > 0) {
        const available = await tx.select({ id: catalogItems.id }).from(catalogItems)
          .where(and(inArray(catalogItems.id, catalogIds), eq(catalogItems.companyId, user.companyId), eq(catalogItems.active, true)));
        if (available.length !== catalogIds.length) throw new Error("Item de catálogo inválido para esta empresa");
        await tx.select({ id: catalogItems.id }).from(catalogItems).where(inArray(catalogItems.id, catalogIds)).orderBy(catalogItems.id).for("update");
        const period = await periodAvailability(user, body.eventDate, body.returnDueDate, tx);
        const quantities = new Map<string, number>();
        for (const item of body.items) if (item.catalogItemId) quantities.set(item.catalogItemId, (quantities.get(item.catalogItemId) ?? 0) + item.qtyPlanned);
        for (const [id, qty] of quantities) {
          const item = period.find(p => p.id === id);
          if (item?.available !== null && item?.available !== undefined && qty > item.available) fail(`Estoque insuficiente para ${item.name}: ${item.available} disponíveis no período`);
        }
      }
      const [{ maxNumber }] = await tx
        .select({ maxNumber: sql<number>`coalesce(max(number), 1000)` })
        .from(orders)
        .where(eq(orders.companyId, user.companyId));

      const [created] = await tx
        .insert(orders)
        .values({
          companyId: user.companyId,
          number: (maxNumber ?? 1000) + 1,
          customerId: body.customerId,
          eventName: body.eventName,
          eventDate: body.eventDate,
          returnDueDate: body.returnDueDate,
          notes: body.notes ?? "",
          status: "rascunho",
          createdBy: user.id,
        })
        .returning();

      await tx.insert(orderItems).values(
        body.items.map((item, i) => ({
          orderId: created.id,
          catalogItemId: item.catalogItemId ?? null,
          name: item.name,
          unit: item.unit,
          qtyPlanned: item.qtyPlanned,
          position: i,
        })),
      );

      return created;
    });

    return { order };
}
