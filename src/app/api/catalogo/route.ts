import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { catalogItems } from "@/lib/db/schema";
import { eq, and, ilike, desc } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";

const createSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  unit: z.string().min(1, "Unidade é obrigatória"),
  replacementCents: z.number().int().nonnegative(),
  damageCents: z.number().int().nonnegative().nullable().optional(),
});

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
    return { items: rows };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { user } = await requireSession();
    const body = createSchema.parse(await req.json());
    const [item] = await db
      .insert(catalogItems)
      .values({
        companyId: user.companyId,
        name: body.name,
        unit: body.unit,
        replacementCents: body.replacementCents,
        damageCents: body.damageCents ?? null,
      })
      .returning();
    return { item };
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const { user } = await requireSession();
    const body = createSchema.partial().extend({ id: z.string().uuid() }).parse(await req.json());
    const { id, ...rest } = body;
    const [item] = await db
      .update(catalogItems)
      .set(rest)
      .where(and(eq(catalogItems.id, id), eq(catalogItems.companyId, user.companyId)))
      .returning();
    if (!item) throw new Error("Item não encontrado");
    return { item };
  });
}
