import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { memberships, users } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { fail } from "@/lib/erp/common";

export async function freshUser(user: SessionUser) {
  const [row] = await db.select({ role: memberships.role, permissions: memberships.permissions }).from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.companyId, user.companyId), eq(memberships.userId, user.id), eq(users.active, true)));
  if (!row) fail("Acesso revogado", 403);
  return { ...user, ...row };
}
