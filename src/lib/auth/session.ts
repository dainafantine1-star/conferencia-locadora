import { auth } from "@/lib/auth/options";
import { db } from "@/lib/db";
import { orders, users, memberships, companies } from "@/lib/db/schema";
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
  accountRole?: import("@/lib/saas/catalog").AccountRole;
  grants?: import("@/lib/saas/catalog").Grants | null;
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
  const [membership] = await db.select({ role: memberships.role, accountRole: memberships.accountRole, grants: memberships.grants, permissions: memberships.permissions, authVersion: users.authVersion, companyName: companies.name, timezone: companies.timezone, name: users.name, email: users.email })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(companies, eq(companies.id, memberships.companyId))
    .where(and(eq(memberships.userId, raw.id), eq(memberships.companyId, raw.companyId), eq(users.active, true), eq(memberships.active, true)));
  if (!membership) throw new AuthError("Acesso revogado", 401);
  if (membership.authVersion !== (raw.authVersion ?? 1)) throw new AuthError("Sua sessão foi revogada. Entre novamente.", 401);
  return {
    user: {
      id: raw.id,
      email: membership.email,
      name: membership.name,
      companyId: raw.companyId,
      companyName: membership.companyName,
      role: membership.role,
      permissions: membership.permissions,
      accountRole: membership.accountRole,
      grants: membership.grants,
      timezone: membership.timezone,
    },
  };
}

export async function requirePermission(permission: Permission) {
  const session = await requireSession();
  const { assertFeature } = await import("@/lib/saas/access");
  const { permissionFeature } = await import("@/lib/saas/catalog");
  await assertFeature(session.user, permissionFeature[permission]);
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
