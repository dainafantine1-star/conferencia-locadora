import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { rentalDocuments, companies, customers, companySettings, financialEntries, settlements } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { fail } from "./common";
import { formatBRL } from "@/lib/money";

export async function textPdf(title: string, sections: { title?: string; lines: string[] }[], createdAt = new Date()) {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  pdf.setTitle(title); pdf.setAuthor("Detali"); pdf.setCreationDate(createdAt); pdf.setModificationDate(createdAt);
  const bytes = await fs.readFile(path.join(process.cwd(), "public/fonts/inter-variable.ttf"));
  const font = await pdf.embedFont(bytes, { subset: true });
  const icon = await pdf.embedPng(await fs.readFile(path.join(process.cwd(), "public/brand/detali-touch.png")));
  let page = pdf.addPage([595.28, 841.89]); let y = 740;
  const ink = rgb(37 / 255, 27 / 255, 35 / 255), burnt = rgb(168 / 255, 50 / 255, 22 / 255);
  const header = () => {
    page.drawImage(icon, { x: 42, y: 775, width: 30, height: 30 });
    page.drawText("detali", { x: 80, y: 782, size: 22, font, color: ink });
    page.drawText(title, { x: 42, y: 750, size: 16, font, color: burnt });
    page.drawLine({ start: { x: 42, y: 736 }, end: { x: 553, y: 736 }, thickness: 1, color: rgb(.85, .79, .76) });
    y = 712;
  };
  const line = (value: string, size = 10) => {
    const words = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").split(/\s+/);
    const rows: string[] = []; let current = "";
    for (const word of words) {
      if (font.widthOfTextAtSize(word, size) > 510) {
        if (current) { rows.push(current); current = ""; }
        let chunk = "";
        for (const char of word) {
          if (font.widthOfTextAtSize(chunk + char, size) > 510) { rows.push(chunk); chunk = char; } else chunk += char;
        }
        current = chunk;
      } else if (font.widthOfTextAtSize(current ? `${current} ${word}` : word, size) > 510) { rows.push(current); current = word; }
      else current = current ? `${current} ${word}` : word;
    }
    rows.push(current);
    for (const row of rows) {
      if (y < 60) { page = pdf.addPage([595.28, 841.89]); header(); }
      page.drawText(row, { x: 42, y, size, font, color: ink }); y -= size * 1.55;
    }
  };
  header();
  for (const section of sections) {
    if (section.title) { y -= 12; line(section.title, 12); y -= 4; }
    for (const value of section.lines) for (const paragraph of value.split(/\r?\n/)) line(paragraph);
    y -= 8;
  }
  for (const [index, current] of pdf.getPages().entries()) current.drawText(`${index + 1} / ${pdf.getPageCount()}`, { x: 505, y: 30, size: 9, font, color: ink });
  return Buffer.from(await pdf.save());
}
export async function rentalPdf(companyId: string, id: string) {
  const [doc] = await db.select().from(rentalDocuments).where(and(eq(rentalDocuments.id, id), eq(rentalDocuments.companyId, companyId)));
  if (!doc) fail("Documento não encontrado", 404);
  const [[company], [customer], [settings], installments] = await Promise.all([
    db.select().from(companies).where(eq(companies.id, companyId)),
    db.select().from(customers).where(eq(customers.id, doc.customerId)),
    db.select().from(companySettings).where(eq(companySettings.companyId, companyId)),
    db.select().from(financialEntries).where(eq(financialEntries.documentId, doc.id)).orderBy(financialEntries.installment),
  ]);
  const snapshot = doc.snapshot;
  if (!customer) fail("Cliente não encontrado", 404);
  const merchant = snapshot?.company ?? { name: settings?.preferences.legalName ?? company.name,
    taxId: settings?.preferences.taxId ?? "", address: settings?.preferences.address ?? "", email: settings?.preferences.email ?? "", phone: settings?.preferences.phone ?? "" };
  const party = snapshot?.customer ?? customer;
  const date = (value: string) => value.split("-").reverse().join("/");
  const kind = doc.kind === "contrato" ? "Contrato de locação" : "Orçamento de locação";
  const sections = [
    { title: "Locadora", lines: [merchant.name, `${merchant.taxId} · ${merchant.email} · ${merchant.phone}`, merchant.address] },
    { title: "Cliente", lines: [party.name, `${party.taxId} · ${party.email} · ${party.phone}`, party.address] },
    { title: "Evento e período", lines: [doc.eventName, `${date(doc.eventDate)} a ${date(doc.returnDueDate)} (datas inclusivas)`, `Entrega: ${doc.deliveryAddress || "Endereço a combinar"}`, `Situação: ${doc.status}`] },
    { title: "Materiais", lines: doc.lines.map(l => `${l.name} | ${l.qty} ${l.unit} x ${l.periods} período(s) x ${formatBRL(l.priceCents)} = ${formatBRL(l.qty * l.periods * l.priceCents)}`) },
    { title: "Valores", lines: [`Locação: ${formatBRL(doc.subtotalCents)}`, `Entrega: ${formatBRL(doc.deliveryCents)}`, `Desconto: ${formatBRL(doc.discountCents)}`, `Total: ${formatBRL(doc.totalCents)}`] },
    ...(installments.length ? [{ title: "Parcelas", lines: installments.map(p => `Parcela ${p.installment} · ${date(p.dueDate)} · ${formatBRL(p.amountCents)}${p.cancelledAt ? " · cancelada" : ""}`) }] : []),
    { title: "Condições", lines: [(snapshot?.terms ?? doc.terms) || "Condições ainda não informadas pela locadora.", doc.notes] },
    { title: "Identificação", lines: [`${kind} #${doc.number} · ${doc.id}`, ...(doc.validUntil ? [`Validade da proposta: ${date(doc.validUntil)}`] : []),
      doc.kind === "contrato" ? "Documento original. A assinatura, quando solicitada, é verificada separadamente pelo provedor configurado." : "Este orçamento não é comprovante de pagamento nem contrato assinado."] },
  ];
  return { document: doc, buffer: await textPdf(`${kind} #${doc.number}`, sections, doc.createdAt) };
}
export async function receiptPdf(user: SessionUser, id: string) {
  const [payment] = await db.select().from(settlements).where(and(eq(settlements.id, id), eq(settlements.companyId, user.companyId)));
  if (!payment) fail("Recibo não encontrado", 404);
  const snap = payment.receiptSnapshot as Record<string, unknown>;
  const lines = [
    `Recibo: ${payment.receiptNumber}`, `Empresa: ${String(snap.company ?? user.companyName)}`,
    `${snap.direction === "pagar" ? "Pagamento a" : "Recebimento de"}: ${String(snap.party ?? "")}`,
    `CPF/CNPJ: ${String(snap.taxId ?? "")}`, `Referente a: ${String(snap.description ?? "")}`,
    `Valor: ${formatBRL(payment.amountCents)}`, `Método: ${payment.method}`,
    `Data: ${payment.occurredAt.toLocaleString("pt-BR", { timeZone: user.timezone })}`, payment.note,
    "Recibo financeiro. Não substitui documento fiscal.",
  ];
  return { settlement: payment, buffer: await textPdf("Recibo de pagamento", [{ lines }], payment.createdAt) };
}
