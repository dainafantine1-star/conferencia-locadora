import { auth } from "@/lib/auth/options";
import { db } from "@/lib/db";
import { orders, users, memberships } from "@/lib/db/schema";
import type { Permission } from "@/lib/erp/types";
import { eq, and } from "drizzle-orm";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  companyId: string;
  companyName: string;
  role: "gestor" | "operador";
  timezone: string;
  permissions?: Permission[];
};

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function requireSession(): Promise<{ user: SessionUser }> {
  const session = await auth();
  const raw = session?.user as
    | {
        id?: string;
        companyId?: string;
        role?: string;
        companyName?: string;
        timezone?: string;
        email?: string;
        name?: string;
        authVersion?: number;
      }
    | undefined;
  if (!session?.user || !raw?.id || !raw?.companyId || !raw?.role) {
    throw new AuthError("Não autenticado", 401);
  }
  // Re-check membership and activation so role changes revoke existing sessions.
  const [membership] = await db.select({ role: memberships.role, permissions: memberships.permissions, authVersion: users.authVersion })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, raw.id), eq(memberships.companyId, raw.companyId), eq(users.active, true)));
  if (!membership) throw new AuthError("Acesso revogado", 401);
  if (membership.authVersion !== (raw.authVersion ?? 1)) throw new AuthError("Sua sessão foi revogada. Entre novamente.", 401);
  return {
    user: {
      id: raw.id,
      email: raw.email ?? "",
      name: raw.name ?? "",
      companyId: raw.companyId,
      companyName: raw.companyName ?? "",
      role: membership.role,
      permissions: membership.permissions,
      timezone: raw.timezone ?? "America/Bahia",
    },
  };
}

export async function requirePermission(permission: Permission) {
  const session = await requireSession();
  if (session.user.role !== "gestor" && !session.user.permissions?.includes(permission)) {
    throw new AuthError("Seu perfil não tem permissão para este módulo", 403);
  }
  return session;
}

export async function requireGestor(): Promise<{ user: SessionUser }> {
  const { user } = await requireSession();
  if (user.role !== "gestor") {
    throw new AuthError("Apenas gestores podem executar esta ação", 403);
  }
  return { user };
}

/** Garante que o pedido pertence à empresa da sessão. */
export async function assertOrderAccess(orderId: string, user: SessionUser) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.companyId, user.companyId)));
  if (!order) {
    throw new AuthError("Pedido não encontrado", 404);
  }
  return order;
}
