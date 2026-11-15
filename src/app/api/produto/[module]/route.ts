import { readJson } from "@/lib/assistant/http";
import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { handle, jsonError } from "@/lib/api/http";
import { requireSession } from "@/lib/auth/session";
import { productData, saveRecord, completeTraining, bookVenue, importParticipants, scanParticipant, participantQr, createPortal, revokePortal, registerDomain, verifyDomain } from "@/lib/saas/product";
import { fail } from "@/lib/erp/common";
type Context = { params: Promise<{ module: string }> };
export async function GET(req: NextRequest, c: Context) {
  try {
    const { user } = await requireSession(); const { module } = await c.params;
    const qr = req.nextUrl.searchParams.get("qr");
    if (module === "checkin" && qr) { const token = await participantQr(user, qr); return new Response(new Uint8Array(await QRCode.toBuffer(token, { width: 400 })), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "Content-Disposition": 'inline; filename="participante-qr.png"' } }); }
    return Response.json(await productData(user, module), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return jsonError(e); }
}
export async function POST(req: NextRequest, c: Context) { return handle(async () => {
  const { user } = await requireSession(); const { module } = await c.params;
  if (Number(req.headers.get("content-length")) > 1000000) fail("Requisição muito grande", 413);
  const body = await readJson(req, 1000000);
  if (module === "treinamentos" && body.action === "complete") return completeTraining(user, body);
  if (module === "locais" && body.action === "book") return bookVenue(user, body);
  if (module === "checkin") { if (body.action === "import") return importParticipants(user, body); if (body.action === "scan") return scanParticipant(user, body); }
  if (module === "portal") return body.action === "revoke" ? revokePortal(user, body) : createPortal(user, body);
  if (module === "dominios") return body.action === "verify" ? verifyDomain(user, body) : registerDomain(user, body);
  return saveRecord(user, module, body);
}); }
