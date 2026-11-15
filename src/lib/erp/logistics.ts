import { assertFeature } from "@/lib/saas/access";
import { z } from "zod";
import { db } from "@/lib/db";
import { logisticsTasks, orders, memberships, users, orderItems, returns, returnItems } from "@/lib/db/schema";
import { and, eq, asc, sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { uuid, fail, audit } from "./common";

const taskSchema = z.object({ orderId: uuid, kind: z.enum(["entrega", "coleta"]), scheduledAt: z.iso.datetime(),
  address: z.string().trim().min(5).max(2000), contact: z.string().max(200).default(""),
  assigneeId: uuid.nullable().optional(), vehicle: z.string().max(100).default(""), notes: z.string().max(3000).default("") });
export async function logisticsData(user: SessionUser) {
  await assertFeature(user, "returns", "view");
  const rows = await db.select({ task: logisticsTasks, orderNumber: orders.number, eventName: orders.eventName, assignee: users.name })
    .from(logisticsTasks).innerJoin(orders, eq(orders.id, logisticsTasks.orderId)).leftJoin(users, eq(users.id, logisticsTasks.assigneeId))
    .where(eq(logisticsTasks.companyId, user.companyId)).orderBy(asc(logisticsTasks.scheduledAt));
  return { tasks: rows.map(r => ({ ...r.task, orderNumber: r.orderNumber, eventName: r.eventName, assignee: r.assignee })) };
}
export async function createLogisticsTask(user: SessionUser, input: unknown) {
  await assertFeature(user, "returns", "create");
  const data = taskSchema.parse(input);
  return db.transaction(async tx => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, data.orderId), eq(orders.companyId, user.companyId))).for("update");
    if (!order || order.status === "cancelado") fail("Pedido não disponível", 404);
    if (data.assigneeId) {
      const [member] = await tx.select({ id: users.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.companyId, user.companyId), eq(users.id, data.assigneeId), eq(users.active, true)));
      if (!member) fail("Responsável não encontrado na equipe");
    }
    const [task] = await tx.insert(logisticsTasks).values({ ...data, scheduledAt: new Date(data.scheduledAt), companyId: user.companyId, createdBy: user.id }).returning();
    await audit(tx, user, "logistica_agendada", { taskId: task.id, kind: task.kind }, order.id);
    return { task };
  });
}
export async function updateLogisticsTask(user: SessionUser, input: unknown) {
  await assertFeature(user, "returns", "edit");
  const data = z.object({ id: uuid, status: z.enum(["em_rota", "concluida", "cancelada"]), notes: z.string().max(3000).optional() }).parse(input);
  return db.transaction(async tx => {
    const [task] = await tx.select().from(logisticsTasks).where(and(eq(logisticsTasks.id, data.id), eq(logisticsTasks.companyId, user.companyId))).for("update");
    if (!task) fail("Tarefa não encontrada", 404);
    if (task.status === data.status) return { task };
    if (["concluida", "cancelada"].includes(task.status)) fail("Tarefa finalizada não pode mudar de status");
    if (data.status === "cancelada" && !data.notes?.trim()) fail("Informe o motivo do cancelamento");
    const [order] = await tx.select().from(orders).where(eq(orders.id, task.orderId)).for("update");
    if (data.status === "concluida") {
      if (task.kind === "entrega" && !order.exitConfirmedAt) fail("Confirme as quantidades de saída no pedido antes de concluir a entrega");
      if (task.kind === "coleta" && order.status !== "encerrado") {
        const [delivered] = await tx.select({ qty: sql<number>`coalesce(sum(${orderItems.qtyDelivered}), 0)::int` }).from(orderItems).where(eq(orderItems.orderId, order.id));
        const [returned] = await tx.select({ qty: sql<number>`coalesce(sum(${returnItems.qtyGood} + ${returnItems.qtyDamaged}), 0)::int` }).from(returnItems)
          .innerJoin(returns, eq(returns.id, returnItems.returnId)).where(eq(returns.orderId, order.id));
        if (!order.exitConfirmedAt || delivered.qty > returned.qty) fail("Confira as devoluções ou conclua o fechamento das faltas antes de finalizar a coleta");
      }
    }
    const [updated] = await tx.update(logisticsTasks).set({ status: data.status, notes: data.notes ?? task.notes,
      completedAt: data.status === "concluida" ? new Date() : null }).where(eq(logisticsTasks.id, task.id)).returning();
    await audit(tx, user, "logistica_atualizada", { taskId: task.id, status: data.status, notes: data.notes }, order.id);
    return { task: updated };
  });
}
