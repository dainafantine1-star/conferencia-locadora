import { NextRequest } from "next/server";
import { sharedDocument, acceptSharedQuote, limitPublicRequests } from "@/lib/erp/store";
import { rentalPdf } from "@/lib/erp/pdf";
import { createCheckout, syncSignature } from "@/lib/erp/integrations";
import { handle, jsonError } from "@/lib/api/http";
import { fail } from "@/lib/erp/common";
import type { SessionUser } from "@/lib/auth/session";

type Context = { params: Promise<{ token: string }> };
export async function GET(req: NextRequest, context: Context) {
  try {
    const { token } = await context.params; const doc = await sharedDocument(token);
    if (req.nextUrl.searchParams.get("signed") === "1") {
      const signature = await syncSignature({ id: doc.createdBy, companyId: doc.companyId, role: "gestor" } as SessionUser, { id: doc.id });
      if (signature.signature.status !== "signed" || !signature.signature.signedFileUrl) fail("Assinatura ainda não confirmada");
      return Response.redirect(signature.signature.signedFileUrl);
    }
    const pdf = await rentalPdf(doc.companyId, doc.id);
    return new Response(new Uint8Array(pdf.buffer), { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return jsonError(error); }
}
export async function POST(req: NextRequest, context: Context) {
  return handle(async () => {
    const { token } = await context.params;
    await sharedDocument(token);
    await limitPublicRequests(`documento:${token}`, 30);
    const body = await req.json();
    if (body.action === "aceitar" && body.consent === true) return acceptSharedQuote(token);
    if (body.action === "checkout") {
      const doc = await sharedDocument(token);
      if (!doc.installments.some(p => p.id === body.entryId && p.balanceCents > 0)) fail("Parcela indisponível");
      // The capability token authorizes only this document's own installments.
      const actor = { id: doc.createdBy, companyId: doc.companyId, role: "gestor", timezone: "America/Bahia" } as SessionUser;
      return createCheckout(actor, { entryId: body.entryId });
    }
    fail("Ação inválida");
  });
}
