import { assertFeature } from "@/lib/saas/access";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { uuid, optionalEmail, text, audit, fail } from "./common";

export const customerEditableFields = z.object({ name: z.string().trim().min(1).max(200), phone: z.string().max(40), email: optionalEmail.removeDefault(), taxId: z.string().max(30), address: text.removeDefault(), notes: text.removeDefault() });
export const customerFields = customerEditableFields.extend({ phone: customerEditableFields.shape.phone.default(""), email: optionalEmail, taxId: customerEditableFields.shape.taxId.default(""), address: text, notes: text });
export const customerCreateSchema = customerFields.extend({ active: z.boolean().default(true) });
export const customerUpdateSchema = customerEditableFields.extend({ active: z.boolean() }).partial().extend({ id: uuid });
export async function createCustomer(user: SessionUser, input: unknown) {
  await assertFeature(user, "customers", "create");
  const data = customerCreateSchema.parse(input);
  return db.transaction(async tx => {
    const [customer] = await tx.insert(customers).values({ ...data, companyId: user.companyId }).returning();
    await audit(tx, user, "cliente_criado", { id: customer.id }); return { customer };
  });
}
export async function updateCustomer(user: SessionUser, input: unknown) {
  const { id, ...values } = customerUpdateSchema.parse(input);
  await assertFeature(user, "customers", values.active === false ? "delete" : "edit");
  if (!Object.keys(values).length) fail("Informe os campos para atualizar");
  return db.transaction(async tx => {
    const [customer] = await tx.update(customers).set(values).where(and(eq(customers.id, id), eq(customers.companyId, user.companyId))).returning();
    if (!customer) fail("Cliente não encontrado", 404);
    await audit(tx, user, "cliente_atualizado", { id, fields: Object.keys(values) }); return { customer };
  });
}
