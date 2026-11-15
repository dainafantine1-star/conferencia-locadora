import { db } from "@/lib/db";
import { scanLabels, catalogItems } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/session";
import { eq, and } from "drizzle-orm";
import QRCode from "qrcode";
import { jsonError } from "@/lib/api/http";
const escape = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export async function GET() {
  try {
    const { user } = await requireSession();
    const labels = await db.select({ code: scanLabels.code, kind: scanLabels.kind, qty: scanLabels.qty, name: catalogItems.name, unit: catalogItems.unit })
      .from(scanLabels).innerJoin(catalogItems, eq(catalogItems.id, scanLabels.catalogItemId))
      .where(and(eq(scanLabels.companyId, user.companyId), eq(scanLabels.active, true))).limit(2000);
    const rows = await Promise.all(labels.map(async l => `<section><p>${escape(l.name)}</p><img alt="QR ${escape(l.code)}" width="144" height="144" src="${await QRCode.toDataURL(l.code, { width: 144, errorCorrectionLevel: "M" })}"><strong>${escape(l.code)}</strong><small>${l.kind === "caixa" ? `Caixa: ${l.qty} ` : "1 "}${escape(l.unit)}</small></section>`));
    return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas Detali</title><style>body{font:14px system-ui}main{display:flex;flex-wrap:wrap;gap:8px}section{border:1px dashed #555;break-inside:avoid;width:180px;padding:8px;text-align:center}p{margin:0;min-height:2rem}strong,small{display:block}button{padding:12px;margin:16px}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Imprimir etiquetas</button><main>${rows.join("")}</main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'" } });
  } catch (error) { return jsonError(error); }
}
