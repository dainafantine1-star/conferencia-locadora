import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { handle, jsonError } from "@/lib/api/http";
import { fail, uuid } from "@/lib/erp/common";
import { fiscalData, invoiceDetail, invoiceFile, issueInvoice, saveDraft, syncInvoice } from "@/lib/fiscal/invoices";
import { fiscalSettingsData, saveFiscalSettings } from "@/lib/fiscal/config";
import { sendFiscalWhatsApp } from "@/lib/fiscal/whatsapp";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  try {
    const { user } = await requirePermission("fiscal"), q = req.nextUrl.searchParams;
    if (q.get("settings") === "1") return Response.json(await fiscalSettingsData(user), { headers: { "Cache-Control": "private, no-store" } });
    if (q.has("id")) {
      const id = uuid.parse(q.get("id")), format = q.get("format");
      if (format) {
        if (format !== "pdf" && format !== "xml") fail("Formato fiscal inválido");
        const file = await invoiceFile(user, id, format, false);
        return new Response(new Uint8Array(file.buffer), { headers: { "Content-Type": format === "pdf" ? "application/pdf" : "application/xml", "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
      }
      return Response.json(await invoiceDetail(user, id), { headers: { "Cache-Control": "private, no-store" } });
    }
    return Response.json(await fiscalData(user, q), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return jsonError(error); }
}
export async function POST(req: NextRequest) {
  return handle(async () => {
    const { user } = await requirePermission("fiscal");
    if (Number(req.headers.get("content-length")) > 500000) fail("Requisição fiscal muito grande", 413);
    const raw = await req.text(); if (Buffer.byteLength(raw) > 500000) fail("Requisição fiscal muito grande", 413);
    const { action, ...body } = JSON.parse(raw);
    if (action === "configurar") return saveFiscalSettings(user, body);
    if (action === "rascunho") return saveDraft(user, body);
    if (action === "emitir") return issueInvoice(user, body);
    if (action === "consultar") return syncInvoice(user, body);
    if (action === "whatsapp") return sendFiscalWhatsApp(user, body);
    fail("Ação fiscal desconhecida");
  });
}
