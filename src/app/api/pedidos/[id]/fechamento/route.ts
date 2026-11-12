import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession, assertOrderAccess, requireGestor } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";
import { closeOrder } from "@/lib/business/closures";

const closeSchema = z.object({
  confirmedMissingQty: z.number().int().nonnegative(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { user } = await requireGestor();
    const { id } = await params;
    await assertOrderAccess(id, user);
    const body = closeSchema.parse(await req.json());
    const closure = await closeOrder(
      { orderId: id, confirmedMissingQty: body.confirmedMissingQty },
      user,
    );
    return { closure };
  });
}
