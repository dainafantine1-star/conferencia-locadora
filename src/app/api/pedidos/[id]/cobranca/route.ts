import { NextRequest } from "next/server";
import { z } from "zod";
import { requireGestor, assertOrderAccess } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";
import { adjustCharge, setBillingStatus } from "@/lib/business/closures";

const adjustSchema = z.object({
  action: z.literal("adjust"),
  adjustmentCents: z.number().int().nonnegative(),
  reason: z.string().min(1, "Justificativa é obrigatória"),
});

const statusSchema = z.object({
  action: z.literal("status"),
  status: z.enum(["sem_cobranca", "pendente", "recebida", "dispensada"]),
  note: z.string().optional(),
});

const bodySchema = z.discriminatedUnion("action", [adjustSchema, statusSchema]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { user } = await requireGestor();
    const { id } = await params;
    await assertOrderAccess(id, user);
    const body = bodySchema.parse(await req.json());

    if (body.action === "adjust") {
      const result = await adjustCharge(
        { orderId: id, adjustmentCents: body.adjustmentCents, reason: body.reason },
        user,
      );
      return { closure: result };
    }

    const result = await setBillingStatus(
      { orderId: id, status: body.status, note: body.note },
      user,
    );
    return result;
  });
}
