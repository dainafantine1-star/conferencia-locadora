import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, orderItems, customers, returns, returnItems } from "@/lib/db/schema";
import { eq, and, or, ilike, sql, desc } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";
import { computeBalances, calculateClosing } from "@/lib/business/types";

const createSchema = z.object({
  customerId: z.string().uuid(),
  eventName: z.string().min(1, "Informe o evento"),
  eventDate: z.string().min(1, "Informe a data do evento"),
  returnDueDate: z.string().min(1, "Informe a previsão de devolução"),
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
});

export async function GET(req: NextRequest) {
  return handle(async () => {
    const { user } = await requireSession();
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";

    const customerJoin = sql`inner join customers c on c.id = orders.customer_id`;

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
    const body = createSchema.parse(await req.json());

    const [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, body.customerId), eq(customers.companyId, user.companyId)));
    if (!customer) throw new Error("Cliente não encontrado");

    const order = await db.transaction(async (tx) => {
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
  });
}
