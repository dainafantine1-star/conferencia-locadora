import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, memberships, customers, catalogItems, orders, messageLog } from "@/lib/db/schema";
import { requireSession, requireGestor, requirePermission } from "@/lib/auth/session";
import type { Permission } from "@/lib/erp/types";
import { handle, jsonError } from "@/lib/api/http";
import { fail, csv, uuid } from "@/lib/erp/common";
import { supplierData, saveSupplier } from "@/lib/erp/contacts";
import { inventoryData, moveStock } from "@/lib/erp/inventory";
import { commercialData, createQuote, reviseQuote, convertToContract, cancelDocument, shareDocument, reserveQuote, releaseQuote } from "@/lib/erp/commercial";
import { financeData, createFinancialEntry, settleEntry, cancelEntry, commissionData, payCommission, importConference } from "@/lib/erp/finance";
import { logisticsData, createLogisticsTask, updateLogisticsTask } from "@/lib/erp/logistics";
import { settingsData, saveSettings } from "@/lib/erp/settings";
import { storeData, savePage, updateLead, quoteFromLead } from "@/lib/erp/store";
import { holidayData, saveHoliday, importHolidays, deleteHoliday } from "@/lib/erp/holidays";
import { backupData, createBackup, downloadBackup } from "@/lib/erp/backup";
import { reportData } from "@/lib/erp/reports";
import { sendDocument, createCheckout, requestSignature, syncSignature, testSmtp } from "@/lib/erp/integrations";
import { rentalPdf, receiptPdf } from "@/lib/erp/pdf";
import { teamData, createMember, updateMember } from "@/lib/erp/team";
import { allowedAction, entitlement } from "@/lib/saas/access";
import type { FeatureId } from "@/lib/saas/catalog";

export const runtime = "nodejs";
type Context = { params: Promise<{ module: string }> };
const access: Record<string, Permission> = { fornecedores: "clientes", estoque: "estoque", comercial: "comercial", financeiro: "financeiro",
  comissoes: "financeiro", logistica: "logistica", relatorios: "relatorios", documentos: "comercial", recibos: "financeiro" };
async function sessionFor(module: string) {
  if (access[module]) return requirePermission(access[module]);
  if (["configuracoes", "loja", "backups", "mensagens", "equipe"].includes(module)) return requireGestor();
  if (["opcoes", "feriados"].includes(module)) return requireSession();
  return fail("Módulo não encontrado", 404);
}
export async function GET(req: NextRequest, context: Context) {
  try {
    const { module } = await context.params;
    const { user } = await sessionFor(module);
    const query = req.nextUrl.searchParams;
    if (module === "documentos" || module === "recibos") {
      const id = uuid.parse(query.get("id"));
      if (module === "documentos" && query.get("signed") === "1") {
        const result = await syncSignature(user, { id });
        const url = result.signature.signedFileUrl;
        if (result.signature.status !== "signed" || !url) fail("Assinatura ainda não confirmada pelo provedor");
        return Response.redirect(url);
      }
      const content = module === "documentos" ? await rentalPdf(user.companyId, id) : await receiptPdf(user, id);
      return new Response(new Uint8Array(content.buffer), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${module}-${id}.pdf"`, "Cache-Control": "private, no-store" } });
    }
    if (module === "backups" && query.has("download")) {
      const id = uuid.parse(query.get("download"));
      return new Response(new Uint8Array(await downloadBackup(user, id)), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="backup-${id}.detali"`, "Cache-Control": "private, no-store" } });
    }
    let data: unknown;
    switch (module) {
      case "opcoes": {
        const { plan } = await entitlement(user.companyId);
        const visible = (feature: FeatureId) => plan.features[feature] && allowedAction(user, feature, "view");
        const [clients, products, team, jobs] = await Promise.all([
          db.select().from(customers).where(eq(customers.companyId, user.companyId)).orderBy(customers.name),
          db.select().from(catalogItems).where(eq(catalogItems.companyId, user.companyId)).orderBy(catalogItems.name),
          db.select({ id: users.id, name: users.name }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.companyId, user.companyId), eq(users.active, true))),
          db.select({ id: orders.id, number: orders.number, eventName: orders.eventName, status: orders.status }).from(orders).where(eq(orders.companyId, user.companyId)).orderBy(desc(orders.createdAt)),
        ]);
        // Related forms receive only selector fields when the full module is not available.
        data = { customers: visible("customers") ? clients : ["proposals", "finance", "events", "weekly", "responsibles"].some(f => visible(f as FeatureId)) ? clients.map(c => ({ id: c.id, name: c.name, active: c.active })) : [],
          products: visible("inventory") ? products : visible("proposals") ? products.map(p => ({ id: p.id, name: p.name, unit: p.unit, active: p.active, rentalPriceCents: p.rentalPriceCents, priceUnit: p.priceUnit })) : [],
          team, orders: ["events", "returns", "venues", "checkin", "weekly"].some(f => visible(f as FeatureId)) ? jobs : [], role: user.role, permissions: user.permissions ?? [], timezone: user.timezone }; break;
      }
      case "fornecedores": data = await supplierData(user); break;
      case "equipe": data = await teamData(user); break;
      case "estoque": data = await inventoryData(user, query); break;
      case "comercial": data = await commercialData(user, query); break;
      case "financeiro": data = await financeData(user, query); break;
      case "comissoes": data = await commissionData(user); break;
      case "logistica": data = await logisticsData(user); break;
      case "configuracoes": data = await settingsData(user); break;
      case "loja": data = await storeData(user); break;
      case "feriados": data = await holidayData(user, query); break;
      case "backups": data = await backupData(user); break;
      case "mensagens": data = { messages: await db.select().from(messageLog).where(eq(messageLog.companyId, user.companyId)).orderBy(desc(messageLog.createdAt)).limit(200) }; break;
      case "relatorios": {
        const report = await reportData(user, query);
        const kind = query.get("csv");
        if (kind) {
          const rows = kind === "financeiro" ? report.entries : kind === "estoque" ? report.inventory : kind === "vendas" ? report.sales : kind === "caixa" ? report.cash : null;
          if (!rows) fail("Relatório desconhecido");
          return new Response(csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind}-${report.start}-${report.end}.csv"`, "Cache-Control": "private, no-store" } });
        }
        data = report; break;
      }
    }
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return jsonError(error); }
}
export async function POST(req: NextRequest, context: Context) {
  return handle(async () => {
    const { module } = await context.params;
    const { user } = await sessionFor(module);
    if (Number(req.headers.get("content-length")) > 200000) fail("Requisição muito grande", 413);
    const body = await req.json();
    const { action } = body;
    switch (module) {
      case "fornecedores": return saveSupplier(user, body);
      case "equipe": return action === "atualizar" ? updateMember(user, body) : createMember(user, body);
      case "estoque": return moveStock(user, body);
      case "comercial":
        if (action === "reservar") return reserveQuote(user, body);
        if (action === "liberar_reserva") return releaseQuote(user, body);
        if (action === "revisar") return reviseQuote(user, body);
        if (action === "contratar") return convertToContract(user, body);
        if (action === "cancelar") return cancelDocument(user, body);
        if (action === "compartilhar") return shareDocument(user, body);
        if (action === "enviar") return sendDocument(user, body);
        if (action === "assinar") return requestSignature(user, body);
        if (action === "consultar_assinatura") return syncSignature(user, body);
        if (action === "criar") return createQuote(user, body);
        break;
      case "financeiro":
        if (action === "importar_conferencia") return importConference(user, body);
        if (action === "criar") return createFinancialEntry(user, body);
        if (action === "baixar") return settleEntry(user, body);
        if (action === "cancelar") return cancelEntry(user, body);
        if (action === "checkout") return createCheckout(user, body);
        if (action === "recibo_email") return sendDocument(user, { ...body, receipt: true, channel: "email" });
        break;
      case "comissoes": if (action === "pagar") return payCommission(user, body); break;
      case "logistica": return action === "atualizar" ? updateLogisticsTask(user, body) : createLogisticsTask(user, body);
      case "configuracoes": return action === "testar_email" ? testSmtp(user) : saveSettings(user, body);
      case "loja":
        if (action === "pagina") return savePage(user, body);
        if (action === "lead") return updateLead(user, body);
        if (action === "orcamento") return quoteFromLead(user, body);
        break;
      case "feriados": {
        await requireGestor();
        if (action === "importar") return importHolidays(user, body);
        if (action === "excluir") return deleteHoliday(user, body);
        return saveHoliday(user, body);
      }
      case "backups": return createBackup(user);
    }
    fail("Ação desconhecida", 400);
  });
}
