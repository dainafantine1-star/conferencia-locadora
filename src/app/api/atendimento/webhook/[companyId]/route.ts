import { NextRequest } from "next/server";
import { jsonError } from "@/lib/api/http";
import { aiConfig } from "@/lib/assistant/config";
import { constantEqual, ingestWebhook } from "@/lib/assistant/channels";
import { boundedBody } from "@/lib/assistant/http";
import { uuid, fail } from "@/lib/erp/common";
export const runtime = "nodejs";
type Context = { params: Promise<{ companyId: string }> };
export async function GET(req: NextRequest, ctx: Context) {
  try {
    const { companyId } = await ctx.params; uuid.parse(companyId); const c = await aiConfig(companyId);
    if (!c.secrets.verifyToken || req.nextUrl.searchParams.get("hub.mode") !== "subscribe" || !constantEqual(req.nextUrl.searchParams.get("hub.verify_token") ?? "", c.secrets.verifyToken)) fail("Verificação não autorizada", 403);
    const challenge = req.nextUrl.searchParams.get("hub.challenge") ?? "";
    if (challenge.length > 500) fail("Desafio inválido");
    return new Response(challenge, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  } catch (e) { return jsonError(e); }
}
export async function POST(req: NextRequest, ctx: Context) {
  try { const { companyId } = await ctx.params; const result = await ingestWebhook(companyId, await boundedBody(req, 250000), req.headers); return Response.json(result); }
  catch (e) { return jsonError(e); }
}
