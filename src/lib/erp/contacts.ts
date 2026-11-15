import { assertFeature } from "@/lib/saas/access";
import { z } from "zod";
import { db } from "@/lib/db";
import { suppliers } from "@/lib/db/schema";
import { and, eq, asc } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { uuid, text, optionalEmail, fail, audit } from "./common";

const supplierSchema = z.object({ id: uuid.optional(), name: z.string().trim().min(1).max(300),
  email: optionalEmail, phone: z.string().max(40).default(""), taxId: z.string().max(30).default(""),
  address: text, notes: text, active: z.boolean().default(true) });
export async function supplierData(user: SessionUser) {
  await assertFeature(user, "suppliers", "view");
  return { suppliers: await db.select().from(suppliers).where(eq(suppliers.companyId, user.companyId)).orderBy(asc(suppliers.name)) };
}
export async function saveSupplier(user: SessionUser, input: unknown) {
  const { id, ...values } = supplierSchema.parse(input);
  await assertFeature(user, "suppliers", !values.active ? "delete" : id ? "edit" : "create");
  return db.transaction(async tx => {
    const [supplier] = id ? await tx.update(suppliers).set(values).where(and(eq(suppliers.id, id), eq(suppliers.companyId, user.companyId))).returning()
      : await tx.insert(suppliers).values({ ...values, companyId: user.companyId }).returning();
    if (!supplier) fail("Fornecedor não encontrado", 404);
    await audit(tx, user, "fornecedor_salvo", { id: supplier.id, active: supplier.active });
    return { supplier };
  });
}
