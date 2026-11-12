import { NextRequest } from "next/server";
import { requireSession, assertOrderAccess } from "@/lib/auth/session";
import { handle } from "@/lib/api/http";
import { buildOrderSummary } from "@/lib/business/closures";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { user } = await requireSession();
    const { id } = await params;
    await assertOrderAccess(id, user);
    return buildOrderSummary(id, user);
  });
}
