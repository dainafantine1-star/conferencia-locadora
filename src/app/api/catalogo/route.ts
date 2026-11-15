import { createProduct, updateProduct } from '@/lib/erp/catalog';
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { catalogItems } from "@/lib/db/schema";
import { eq, and, ilike, desc } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";
import { requirePermission } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const { user } = await requireSession();
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    const rows = await db
      .select()
      .from(catalogItems)
      .where(
        q
          ? and(
              eq(catalogItems.companyId, user.companyId),
              ilike(catalogItems.name, `%${q}%`),
            )
          : eq(catalogItems.companyId, user.companyId),
      )
      .orderBy(desc(catalogItems.createdAt))
      .limit(200);
    return { items: rows, canManage: user.role === "gestor" || user.permissions?.includes("estoque") };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { user } = await requirePermission('estoque');
    return createProduct(user, await req.json());
  });
}
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const { user } = await requirePermission('estoque');
    return updateProduct(user, await req.json());
  });
}
