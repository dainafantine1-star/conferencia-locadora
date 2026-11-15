import { NextRequest } from "next/server";
import { pagbankWebhook } from "@/lib/erp/integrations";
import { handle } from "@/lib/api/http";
import { fail, uuid } from "@/lib/erp/common";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params; uuid.parse(id);
    if (Number(req.headers.get("content-length")) > 100000) fail("Requisição muito grande", 413);
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 100000) fail("Requisição muito grande", 413);
    return pagbankWebhook(id, raw, req.headers.get("x-authenticity-token") ?? "");
  });
}
