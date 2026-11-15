import { assertFeature } from "@/lib/saas/access";
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { scanLabels, catalogItems, auditLog } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireSession, requirePermission } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";
import crypto from "crypto";

const generateSchema = z.object({
  catalogItemId: z.string().uuid(),
  kind: z.enum(["unidade", "caixa"]),
  /**
   * unidade: nº de etiquetas (1 unidade cada)
   * caixa: nº de unidades contadas a cada bipagem desta caixa
   */
  count: z.number().int().positive().max(500),
  /** caixa: quantas etiquetas de caixa gerar (padrão 1) */
  labelQty: z.number().int().positive().max(50).optional().default(1),
});

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i === 3) out += "-";
  }
  return `LOC-${out}`;
}

async function uniqueCode(companyId: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const exists = await db
      .select({ id: scanLabels.id })
      .from(scanLabels)
      .where(and(eq(scanLabels.companyId, companyId), eq(scanLabels.code, code)))
      .limit(1);
    if (exists.length === 0) return code;
  }
  throw new Error("Não foi possível gerar códigos únicos");
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const { user } = await requireSession();
    await assertFeature(user, "inventory", "view");
    const catalogItemId = req.nextUrl.searchParams.get("catalogItemId");
    const rows = await db
      .select({
        id: scanLabels.id,
        code: scanLabels.code,
        kind: scanLabels.kind,
        qty: scanLabels.qty,
        active: scanLabels.active,
        catalogItemId: scanLabels.catalogItemId,
        catalogName: catalogItems.name,
        unit: catalogItems.unit,
      })
      .from(scanLabels)
      .innerJoin(catalogItems, eq(catalogItems.id, scanLabels.catalogItemId))
      .where(
        catalogItemId
          ? and(
              eq(scanLabels.companyId, user.companyId),
              eq(scanLabels.catalogItemId, catalogItemId),
            )
          : eq(scanLabels.companyId, user.companyId),
      )
      .orderBy(desc(scanLabels.createdAt))
      .limit(500);
    return { labels: rows };
  });
}

/** Gera etiquetas em lote. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const { user } = await requirePermission("estoque");
    await assertFeature(user, "inventory", "create");
    const body = generateSchema.parse(await req.json());

    const [item] = await db
      .select()
      .from(catalogItems)
      .where(
        and(eq(catalogItems.id, body.catalogItemId), eq(catalogItems.companyId, user.companyId)),
      );
    if (!item) throw new Error("Item do catálogo não encontrado");

    const created: { code: string; kind: string; qty: number }[] = [];

    if (body.kind === "unidade") {
      for (let i = 0; i < body.count; i++) {
        const code = await uniqueCode(user.companyId);
        const [row] = await db
          .insert(scanLabels)
          .values({
            companyId: user.companyId,
            catalogItemId: body.catalogItemId,
            code,
            kind: "unidade",
            qty: 1,
          })
          .returning();
        created.push({ code: row.code, kind: row.kind, qty: row.qty });
      }
    } else {
      // caixa: `count` unidades por bipagem; gera `labelQty` etiquetas
      for (let i = 0; i < body.labelQty; i++) {
        const code = await uniqueCode(user.companyId);
        const [row] = await db
          .insert(scanLabels)
          .values({
            companyId: user.companyId,
            catalogItemId: body.catalogItemId,
            code,
            kind: "caixa",
            qty: body.count,
          })
          .returning();
        created.push({ code: row.code, kind: row.kind, qty: row.qty });
      }
    }

    await db.insert(auditLog).values({
      companyId: user.companyId,
      action: "etiquetas_geradas",
      payload: {
        catalogItemId: body.catalogItemId,
        kind: body.kind,
        count: body.count,
        labelQty: body.labelQty,
        total: created.length,
      },
      createdBy: user.id,
    });

    return { labels: created, item: item.name, kind: body.kind };
  });
}
