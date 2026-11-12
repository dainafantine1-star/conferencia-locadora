import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession, assertOrderAccess } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";
import { registerReturn } from "@/lib/business/returns";
import { loadOrderBalances } from "@/lib/business/closures";

const schema = z.object({
  lines: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        qtyGood: z.number().int().nonnegative(),
        qtyDamaged: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  notes: z.string().optional().default(""),
  idempotencyKey: z.string().min(8).optional(),
  /** Ação rápida: todo o saldo em aberto como bom (linhas já calculadas no cliente). */
  markAllGood: z.boolean().optional().default(false),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { user } = await requireSession();
    const { id } = await params;
    await assertOrderAccess(id, user);
    const body = schema.parse(await req.json());

    const result = await registerReturn(
      {
        orderId: id,
        lines: body.lines,
        notes: body.notes,
        idempotencyKey: body.idempotencyKey,
      },
      user,
    );

    return {
      returnId: result.returnId,
      duplicated: result.duplicated,
      balances: result.balances,
    };
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { user } = await requireSession();
    const { id } = await params;
    await assertOrderAccess(id, user);
    const balances = await loadOrderBalances(id);
    return { balances };
  });
}
