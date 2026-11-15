import { assertFeature } from "@/lib/saas/access";
import { createCustomer, updateCustomer } from '@/lib/erp/customer';
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { eq, and, ilike, desc } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";
import { requirePermission } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const { user } = await requireSession();
    await assertFeature(user, "customers", "view");
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    const rows = await db
      .select()
      .from(customers)
      .where(
        q
          ? and(eq(customers.companyId, user.companyId), ilike(customers.name, `%${q}%`))
          : eq(customers.companyId, user.companyId),
      )
      .orderBy(desc(customers.createdAt))
      .limit(200);
    return { customers: rows };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { user } = await requirePermission('clientes');
    return createCustomer(user, await req.json());
  });
}
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const { user } = await requirePermission('clientes');
    return updateCustomer(user, await req.json());
  });
}
