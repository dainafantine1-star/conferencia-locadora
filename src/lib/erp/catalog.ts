import { assertFeature } from "@/lib/saas/access";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { catalogItems, stockMovements } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { cents, mediaValue, uuid, audit, fail } from "./common";

export const productSchema = z.object({ name: z.string().trim().min(1).max(300), unit: z.string().min(1).max(20), stockQty: z.number().int().min(0).max(1000000).nullable().optional(), replacementCents: cents, damageCents: cents.nullable().optional(), rentalPriceCents: cents.nullable().optional(), priceUnit: z.enum(["evento", "diaria", "hora"]).optional(), description: z.string().max(5000).optional(), imageUrl: mediaValue.optional(), published: z.boolean().optional(), featured: z.boolean().optional(), active: z.boolean().optional() });
export const productUpdateSchema = productSchema.partial().extend({ id: uuid });
export async function createProduct(user: SessionUser, input: unknown) {
  await assertFeature(user, "inventory", "create");
  const data = productSchema.parse(input);
  return db.transaction(async tx => {
    const [item] = await tx.insert(catalogItems).values({ ...data, companyId: user.companyId, stockQty: data.stockQty ?? null, damageCents: data.damageCents ?? null, rentalPriceCents: data.rentalPriceCents ?? null }).returning();
    await audit(tx, user, "produto_criado", { id: item.id }); return { item };
  });
}
export async function updateProduct(user: SessionUser, input: unknown) {
  const { id, ...values } = productUpdateSchema.parse(input);
  await assertFeature(user, "inventory", values.active === false ? "delete" : "edit");
  if (!Object.keys(values).length) fail("Informe os campos para atualizar");
  return db.transaction(async tx => {
    const [current] = await tx.select().from(catalogItems).where(and(eq(catalogItems.id, id), eq(catalogItems.companyId, user.companyId))).for("update");
    if (!current) fail("Item não encontrado", 404);
    if (values.stockQty === null && current.stockQty !== null) fail("Use o inventário para corrigir o estoque já cadastrado");
    if (values.stockQty !== undefined && values.stockQty !== null && values.stockQty < current.unavailableQty) fail("O estoque não pode ser menor que as unidades indisponíveis");
    const [item] = await tx.update(catalogItems).set(values).where(eq(catalogItems.id, id)).returning();
    if (values.stockQty !== undefined && values.stockQty !== null && values.stockQty !== current.stockQty) await tx.insert(stockMovements).values({ companyId: user.companyId, catalogItemId: id, kind: "inventario", delta: values.stockQty - (current.stockQty ?? 0), reason: "Inventário atualizado pelo catálogo", createdBy: user.id });
    await audit(tx, user, "produto_atualizado", { id, fields: Object.keys(values) }); return { item };
  });
}
