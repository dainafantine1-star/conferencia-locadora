import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { db } from "@/lib/db";
import { memberships, users, companies } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  companyId: string;
  companyName: string;
  role: "gestor" | "operador";
  timezone: string;
};

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function requireSession(): Promise<{ user: SessionUser }> {
  const session = await getServerSession(authOptions);
  const raw = session?.user as
    | { id?: string; companyId?: string; role?: string }
    | undefined;
  if (!session?.user || !raw?.id || !raw?.companyId || !raw?.role) {
    throw new AuthError("Não autenticado", 401);
  }
  return {
    user: {
      id: raw.id,
      email: session.user.email ?? "",
      name: session.user.name ?? "",
      companyId: raw.companyId,
      companyName: (session.user as { companyName?: string }).companyName ?? "",
      role: raw.role as "gestor" | "operador",
      timezone: (session.user as { timezone?: string }).timezone ?? "America/Bahia",
    },
  };
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
  const { orders } = await import("@/lib/db/schema");
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.companyId, user.companyId)));
  if (!order) {
    throw new AuthError("Pedido não encontrado", 404);
  }
  return order;
}
