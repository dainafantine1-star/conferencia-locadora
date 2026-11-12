import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { eq, and, ilike, desc } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";

const createSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  phone: z.string().optional().default(""),
});

export async function GET(req: NextRequest) {
  return handle(async () => {
    const { user } = await requireSession();
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
    const { user } = await requireSession();
    const body = createSchema.parse(await req.json());
    const [customer] = await db
      .insert(customers)
      .values({ companyId: user.companyId, name: body.name, phone: body.phone ?? "" })
      .returning();
    return { customer };
  });
}
