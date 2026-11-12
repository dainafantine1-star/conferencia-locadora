import { NextRequest } from "next/server";
import { z } from "zod";
import { requireGestor, assertOrderAccess } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";
import { reopenOrder } from "@/lib/business/closures";

const schema = z.object({
  reason: z.string().min(1, "Motivo é obrigatório"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { user } = await requireGestor();
    const { id } = await params;
    await assertOrderAccess(id, user);
    const body = schema.parse(await req.json());
    const result = await reopenOrder({ orderId: id, reason: body.reason }, user);
    return result;
  });
}
