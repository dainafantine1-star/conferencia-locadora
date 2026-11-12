import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, orderItems, catalogItems, auditLog } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireSession, assertOrderAccess } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";

const schema = z.object({
  lines: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        qtyDelivered: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { user } = await requireSession();
    const { id } = await params;
    const order = await assertOrderAccess(id, user);
    if (order.status === "encerrado") throw new Error("Pedido encerrado");
    if (order.status === "aberto") throw new Error("Saída já confirmada");

    const body = schema.parse(await req.json());
    const itemIds = body.lines.map((l) => l.orderItemId);

    await db.transaction(async (tx) => {
      const items = await tx
        .select()
        .from(orderItems)
        .where(and(inArray(orderItems.id, itemIds), eq(orderItems.orderId, order.id)))
        .for("update");
      if (items.length !== itemIds.length) throw new Error("Item inválido");

      for (const line of body.lines) {
        const item = items.find((i) => i.id === line.orderItemId)!;
        if (line.qtyDelivered > item.qtyPlanned) {
          throw new Error(
            `Entregue (${line.qtyDelivered}) não pode superar o previsto (${item.qtyPlanned}) para ${item.name}`,
          );
        }
      }

      // Copia valores de reposição/avaria do catálogo na confirmação da saída
      const catalogIds = items
        .map((i) => i.catalogItemId)
        .filter((x): x is string => !!x);
      const catalogMap = new Map<string, { replacementCents: number; damageCents: number | null }>();
      if (catalogIds.length > 0) {
        const cats = await tx
          .select()
          .from(catalogItems)
          .where(inArray(catalogItems.id, catalogIds));
        for (const c of cats) {
          catalogMap.set(c.id, {
            replacementCents: c.replacementCents,
            damageCents: c.damageCents,
          });
        }
      }

      for (const line of body.lines) {
        const item = items.find((i) => i.id === line.orderItemId)!;
        const cat = item.catalogItemId ? catalogMap.get(item.catalogItemId) : null;
        await tx
          .update(orderItems)
          .set({
            qtyDelivered: line.qtyDelivered,
            replacementCents: cat?.replacementCents ?? item.replacementCents ?? 0,
            damageCents: cat?.damageCents ?? item.damageCents ?? null,
          })
          .where(eq(orderItems.id, item.id));
      }

      // Itens fora da lista ficam com entrega 0 se nenhum informado?
      // Regra: a lista confere todos os itens do pedido — exigir cobertura completa.
      const allItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
      const covered = new Set(body.lines.map((l) => l.orderItemId));
      const missing = allItems.filter((i) => !covered.has(i.id));
      if (missing.length > 0) {
        throw new Error(
          `Informe a quantidade entregue de todos os itens (faltando: ${missing.map((m) => m.name).join(", ")})`,
        );
      }

      await tx
        .update(orders)
        .set({
          status: "aberto",
          exitConfirmedAt: new Date(),
          exitConfirmedBy: user.id,
        })
        .where(eq(orders.id, order.id));

      await tx.insert(auditLog).values({
        companyId: order.companyId,
        orderId: order.id,
        action: "saida_confirmada",
        payload: { lines: body.lines },
        createdBy: user.id,
      });
    });

    return { ok: true };
  });
}
