import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

const identity = vi.hoisted(() => ({
  id: "00000000-0000-4000-8000-000000000010",
  companyId: "00000000-0000-4000-8000-000000000001",
  role: "gestor" as "gestor" | "operador",
  timezone: "America/Bahia",
  email: "audit@example.test", name: "Auditoria", companyName: "Auditoria A",
}));
vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/lib/db/schema");
  const client = new PGlite();
  return { db: drizzle(client, { schema }), client };
});
// Authentication is a test double here; browser checks use real credentials.
vi.mock("@/lib/auth/session", async () => {
  const { db } = await import("@/lib/db");
  const { orders } = await import("@/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");
  class AuthError extends Error {
    constructor(message: string, public status = 401) { super(message); }
  }
  return {
    AuthError,
    requireSession: async () => ({ user: { ...identity } }),
    requirePermission: async () => {
      if (identity.role !== "gestor") throw new AuthError("Sem permissão", 403);
      return { user: { ...identity } };
    },
    requireGestor: async () => {
      if (identity.role !== "gestor") throw new AuthError("Apenas gestores", 403);
      return { user: { ...identity } };
    },
    assertOrderAccess: async (id: string, user: typeof identity) => {
      const [order] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.companyId, user.companyId)));
      if (!order) throw new AuthError("Pedido não encontrado", 404);
      return order;
    },
  };
});

import { db } from "@/lib/db";
import { POST as createOrder, GET as listOrders } from "@/app/api/pedidos/route";
import { GET as detail } from "@/app/api/pedidos/[id]/route";
import { POST as exit } from "@/app/api/pedidos/[id]/saida/route";
import { POST as registerReturn } from "@/app/api/pedidos/[id]/retorno/route";
import { POST as close } from "@/app/api/pedidos/[id]/fechamento/route";
import { POST as billing } from "@/app/api/pedidos/[id]/cobranca/route";
import { POST as reopen } from "@/app/api/pedidos/[id]/reabrir/route";
import { GET as metrics } from "@/app/api/metricas/route";
import { GET as team } from "@/app/api/equipe/route";
import { POST as createCatalog, PATCH as updateCatalog } from "@/app/api/catalogo/route";
import { PATCH as updateCustomer } from "@/app/api/clientes/route";
import { createQuote, convertToContract, cancelDocument, shareDocument } from "@/lib/erp/commercial";
import { financeData, settleEntry, createFinancialEntry, payCommission, cancelEntry, importConference } from "@/lib/erp/finance";
import { periodAvailability, maximumReserved, moveStock } from "@/lib/erp/inventory";
import { createLogisticsTask, updateLogisticsTask } from "@/lib/erp/logistics";
import { saveSettings, settingsData, decrypt } from "@/lib/erp/settings";
import { publicStore, submitLead, sharedDocument, acceptSharedQuote, savePage, publicPage } from "@/lib/erp/store";
import { createBackup, downloadBackup, decodeBackup } from "@/lib/erp/backup";
import { rentalPdf, receiptPdf } from "@/lib/erp/pdf";
import { createCheckout, requestSignature, sendDocument, pagbankWebhook, authenticPagbankPayload } from "@/lib/erp/integrations";
import { createHash } from "node:crypto";
import { reportData } from "@/lib/erp/reports";
import { restoreTables } from "@/lib/erp/restore";
import { POST as managementPost, GET as managementGet } from "@/app/api/gestao/[module]/route";
import { POST as publicLead } from "@/app/api/loja/[slug]/route";

const companyA = identity.companyId;
const companyB = "00000000-0000-4000-8000-000000000002";
let client: PGlite;
let customerId: string;
let catalogId: string;
let foreignCatalogId: string;
let sequence = 0;
const req = (body?: unknown) => new NextRequest("http://localhost/api/audit", body === undefined ? undefined : {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const params = (id: string) => ({ params: Promise.resolve({ id }) });
function payload(overrides: Record<string, unknown> = {}) {
  return {
    customerId, eventName: "Auditoria funcional", eventDate: "2027-02-10", returnDueDate: "2027-02-12",
    items: [{ catalogItemId: catalogId, name: "Taça", unit: "un", qtyPlanned: 120 }], ...overrides,
  };
}
async function openOrder(qty = 10) {
  const [order] = await db.insert(schema.orders).values({
    companyId: companyA, customerId, number: ++sequence, eventName: "Auditoria",
    eventDate: "2027-02-10", returnDueDate: "2027-02-12", status: "aberto", createdBy: identity.id,
  }).returning();
  const [item] = await db.insert(schema.orderItems).values({
    orderId: order.id, catalogItemId: catalogId, name: "Taça", unit: "un",
    qtyPlanned: qty, qtyDelivered: qty, replacementCents: 1200, damageCents: 1200,
  }).returning();
  return { order, item };
}

beforeAll(async () => {
  client = (await import("@/lib/db") as unknown as { client: PGlite }).client;
  for (const file of readdirSync("drizzle").filter(f => f.endsWith(".sql")).sort()) await client.exec(readFileSync(`drizzle/${file}`, "utf8"));
}, 120000);
beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = "test-only-key-32-characters-or-longer-never-production";
  process.env.BACKUP_DIR = ".data/test-backups";
  identity.companyId = companyA;
  identity.role = "gestor";
  sequence = 0;
  await client.exec("TRUNCATE companies, users CASCADE");
  await db.insert(schema.companies).values([{ id: companyA, name: "Auditoria A" }, { id: companyB, name: "Auditoria B" }]);
  await db.insert(schema.users).values({ id: identity.id, name: "Auditoria", email: "audit@example.test", passwordHash: "not-a-login-fixture" });
  const [customer] = await db.insert(schema.customers).values({ companyId: companyA, name: "Cliente de teste" }).returning();
  customerId = customer.id;
  const [item] = await db.insert(schema.catalogItems).values({ companyId: companyA, name: "Taça", unit: "un", stockQty: 200, replacementCents: 1200, damageCents: 1200 }).returning();
  catalogId = item.id;
  const [foreign] = await db.insert(schema.catalogItems).values({ companyId: companyB, name: "Item de outra empresa", replacementCents: 9900 }).returning();
  foreignCatalogId = foreign.id;
});

async function configuredQuote(qty = 2, price = 1001) {
  await db.insert(schema.memberships).values({ userId: identity.id, companyId: companyA, role: "gestor", commissionBps: 1000 });
  await db.update(schema.customers).set({ email: "customer@example.test", taxId: "00000000000", address: "Endereço exclusivamente de teste" }).where(eq(schema.customers.id, customerId));
  await saveSettings(identity, { preferences: { legalName: "Locadora de teste", taxId: "00000000000000", address: "Endereço de teste", contractTerms: "Cláusulas exclusivamente para teste funcional.", defaultCommissionBps: 1000 } });
  return createQuote(identity, { customerId, sellerId: identity.id, eventName: "Evento de teste", eventDate: "2027-06-10", returnDueDate: "2027-06-12",
    lines: [{ catalogItemId: catalogId, name: "Taça", unit: "un", qty, priceCents: price, periods: 3 }], deliveryCents: 101, discountCents: 7 });
}
describe("gestão comercial, financeira, logística e loja com persistência real", () => {
  it("painel mostra o saldo e o valor recebido de uma cobrança com baixa parcial", async () => {
    const { order } = await openOrder(10); await close(req({ confirmedMissingQty: 10 }), params(order.id));
    const [entry] = await db.select().from(schema.financialEntries);
    await settleEntry(identity, { entryId: entry.id, amountCents: 3000, method: "pix", idempotencyKey: randomUUID() });
    const dashboard = await (await metrics()).json();
    expect(dashboard.revenue.pendente).toBe(9000); expect(dashboard.revenue.recebida).toBe(3000);
  });
  it("cobrança antiga recebida exige conciliação antes da reabertura e não duplica o valor no painel", async () => {
    const { order } = await openOrder(10); await close(req({ confirmedMissingQty: 10 }), params(order.id));
    await db.delete(schema.financialEntries);
    await db.update(schema.orders).set({ billingStatus: "recebida" }).where(eq(schema.orders.id, order.id));
    expect((await reopen(req({ reason: "Conferência adicional" }), params(order.id))).status).toBe(400);
    await importConference(identity, { orderId: order.id, dueDate: "2027-01-01", receivedCents: 12000,
      occurredAt: new Date().toISOString(), method: "pix", confirmed: true });
    const dashboard = await (await metrics()).json(); expect(dashboard.revenue.recebida).toBe(12000);
    expect((await reopen(req({ reason: "Histórico conciliado" }), params(order.id))).status).toBe(200);
  });
  it("salvar outra seção não apaga e-mail, remetente ou banner já configurados", async () => {
    await saveSettings(identity, { preferences: { email: "company@example.test" }, storefront: { contactEmail: "store@example.test", bannerUrl: "https://example.test/banner.png" }, integrations: { mailFrom: "mail@example.test" } });
    await saveSettings(identity, { preferences: { defaultCommissionBps: 1000 }, storefront: { accent: "#FF642E" }, integrations: { whatsappPhoneId: "1234" } });
    const saved = await settingsData(identity);
    expect(saved.preferences.email).toBe("company@example.test"); expect(saved.integrations.mailFrom).toBe("mail@example.test");
    expect(saved.storefront.contactEmail).toBe("store@example.test"); expect(saved.storefront.bannerUrl).toBe("https://example.test/banner.png");
  });
  it("atualizações parciais de catálogo e cliente preservam os campos não enviados", async () => {
    await db.update(schema.catalogItems).set({ imageUrl: "https://example.test/product.png" }).where(eq(schema.catalogItems.id, catalogId));
    expect((await updateCatalog(req({ id: catalogId, stockQty: 201 }))).status).toBe(200);
    expect((await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, catalogId)))[0].imageUrl).toBe("https://example.test/product.png");
    const contact = { phone: "71999999999", email: "customer@example.test", taxId: "00000000000", address: "Endereço preservado", notes: "Observação preservada", active: false };
    await db.update(schema.customers).set(contact).where(eq(schema.customers.id, customerId));
    expect((await updateCustomer(req({ id: customerId, name: "Nome atualizado" }))).status).toBe(200);
    expect((await db.select().from(schema.customers).where(eq(schema.customers.id, customerId)))[0]).toMatchObject({ name: "Nome atualizado", ...contact });
  });
  it("recusa definitiva do PagBank permite corrigir a configuração e tentar novamente sem confirmação fictícia", async () => {
    await saveSettings(identity, { preferences: { publicUrl: "https://example.test" }, secrets: { pagbankToken: "checkout-test-only" } });
    const { entry } = await createFinancialEntry(identity, { direction: "receber", description: "Teste do contrato HTTP do provedor", dueDate: "2027-01-01", amountCents: 10000 });
    const transport = vi.spyOn(globalThis, "fetch");
    try {
      transport.mockResolvedValueOnce(new Response("{}", { status: 401 }));
      await expect(createCheckout(identity, { entryId: entry.id })).rejects.toThrow("HTTP 401");
      expect((await db.select().from(schema.paymentCheckouts))[0].status).toBe("falha");
      expect(await db.select().from(schema.settlements)).toHaveLength(0);
      // This is an HTTP-contract fixture, not a live provider confirmation.
      transport.mockResolvedValueOnce(Response.json({ id: "CHEC_test", links: [{ rel: "PAY", href: "https://example.test/pagar" }] }, { status: 201 }));
      const result = await createCheckout(identity, { entryId: entry.id }); expect(result.checkout.status).toBe("ativo");
      expect((await createCheckout(identity, { entryId: entry.id })).checkout.id).toBe(result.checkout.id);
      expect(transport).toHaveBeenCalledTimes(2); expect(await db.select().from(schema.settlements)).toHaveLength(0);
    } finally { transport.mockRestore(); }
  });
  it("formulário público aceita o Host real mesmo quando o Next reconstrói outra origem interna", async () => {
    await saveSettings(identity, { slug: "loja-teste", storefront: { enabled: true } });
    await db.update(schema.catalogItems).set({ published: true }).where(eq(schema.catalogItems.id, catalogId));
    const body = { kind: "orcamento", name: "Visitante", email: "visitor@example.test", phone: "71999999999", eventDate: "2027-04-01", returnDueDate: "2027-04-02", items: [{ catalogItemId: catalogId, qty: 5 }], consent: true, requestKey: randomUUID() };
    const request = (origin: string) => new NextRequest("http://localhost:3001/api/loja/loja-teste", { method: "POST", headers: { host: "127.0.0.1:3001", origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const context = { params: Promise.resolve({ slug: "loja-teste" }) };
    const result = await publicLead(request("http://127.0.0.1:3001"), context);
    expect(result.status).toBe(200); expect((await result.json()).received).toBe(true);
    expect((await publicLead(request("https://attacker.example"), context)).status).toBe(403);
    expect(await db.select().from(schema.storeLeads)).toHaveLength(1);
  });
  it("checkout ativo é reutilizado sem prazo inventado e bloqueia outra cobrança com saldo diferente", async () => {
    await saveSettings(identity, { preferences: { publicUrl: "https://example.test" }, secrets: { pagbankToken: "checkout-test-only" } });
    const { entry } = await createFinancialEntry(identity, { direction: "receber", description: "Cobrança", dueDate: "2027-01-01", amountCents: 10000 });
    const [checkout] = await db.insert(schema.paymentCheckouts).values({ companyId: companyA, entryId: entry.id, amountCents: 10000,
      status: "ativo", providerId: "CHEC_test", url: "https://example.test/pagar", createdBy: identity.id, createdAt: new Date(Date.now() - 86400000) }).returning();
    expect((await createCheckout(identity, { entryId: entry.id })).checkout.id).toBe(checkout.id);
    await expect(settleEntry(identity, { entryId: entry.id, amountCents: 1000, method: "pix", idempotencyKey: randomUUID() })).rejects.toThrow("cobrança online");
    await db.update(schema.financialEntries).set({ amountCents: 9000 }).where(eq(schema.financialEntries.id, entry.id));
    await expect(createCheckout(identity, { entryId: entry.id })).rejects.toThrow("outro valor");
    expect(await db.select().from(schema.paymentCheckouts)).toHaveLength(1);
  });
  it("não cancela isoladamente uma conta vinculada ao fechamento do pedido", async () => {
    const { order } = await openOrder(1); await close(req({ confirmedMissingQty: 1 }), params(order.id));
    const [entry] = await db.select().from(schema.financialEntries);
    await expect(cancelEntry(identity, { id: entry.id, reason: "Tentativa isolada" })).rejects.toThrow("conferência");
    expect((await financeData(identity, new URLSearchParams())).totals.receber).toBe(1200);
  });
  it("emite contrato, reserva estoque, parcela e apura comissão sem perder centavos", async () => {
    const { document: quote } = await configuredQuote();
    expect(quote.totalCents).toBe(6100);
    const input = { id: quote.id, installments: [{ dueDate: "2027-05-01", amountCents: 2033 }, { dueDate: "2027-06-01", amountCents: 2033 }, { dueDate: "2027-07-01", amountCents: 2034 }] };
    const { document: contract } = await convertToContract(identity, input);
    expect((await convertToContract(identity, input)).document.id).toBe(contract.id);
    expect((await periodAvailability(identity, "2027-06-11", "2027-06-11"))[0].available).toBe(198);
    let finance = await financeData(identity, new URLSearchParams());
    expect(finance.entries).toHaveLength(3);
    for (const entry of finance.entries) await settleEntry(identity, { entryId: entry.id, amountCents: entry.amountCents, method: "pix", idempotencyKey: randomUUID() });
    const generated = await db.select().from(schema.commissions);
    expect(generated.reduce((a, c) => a + c.amountCents, 0)).toBe(600);
    await payCommission(identity, { id: generated[0].id, method: "transferencia", idempotencyKey: randomUUID() });
    finance = await financeData(identity, new URLSearchParams());
    expect(finance.entries.filter(e => e.category === "comissao")).toHaveLength(1);
    expect(finance.entries.filter(e => e.direction === "receber").every(e => e.balanceCents === 0)).toBe(true);
    expect((await db.select().from(schema.commissions)).reduce((a, c) => a + c.amountCents, 0)).toBe(600);
    const report = await reportData(identity, new URLSearchParams({ start: "2026-01-01", end: "2027-12-31" }));
    expect(report.totals.received).toBe(6100); expect(report.totals.paid).toBe(200);
    const pdf = await rentalPdf(companyA, contract.id); expect(pdf.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const receipt = await receiptPdf(identity, finance.settlements[0].id); expect(receipt.buffer.length).toBeGreaterThan(1000);
  }, 30000);
  it("não emite contrato com parcelas divergentes ou estoque insuficiente", async () => {
    const { document: quote } = await configuredQuote(201);
    await expect(convertToContract(identity, { id: quote.id, installments: [{ dueDate: "2027-01-01", amountCents: 1 }] })).rejects.toThrow("soma");
    await expect(convertToContract(identity, { id: quote.id, installments: [{ dueDate: "2027-01-01", amountCents: quote.totalCents }] })).rejects.toThrow("insuficiente");
    expect(await db.select().from(schema.financialEntries)).toHaveLength(0);
    expect(await db.select().from(schema.orders)).toHaveLength(0);
  });
  it("exige configuração explícita de contrato e mantém preço de locação separado da reposição", async () => {
    const { document } = await createQuote(identity, { customerId, eventName: "Teste", eventDate: "2027-01-01", returnDueDate: "2027-01-02", lines: [{ catalogItemId: catalogId, name: "Taça", unit: "un", qty: 1, priceCents: 500, periods: 1 }] });
    await expect(convertToContract(identity, { id: document.id, installments: [{ dueDate: "2027-01-01", amountCents: 500 }] })).rejects.toThrow("modelo de contrato");
    expect(document.totalCents).toBe(500);
  });
  it("calcula o pico simultâneo sem somar locações em períodos distintos", () => {
    expect(maximumReserved([{ start: "2027-01-01", end: "2027-01-02", qty: 5 }, { start: "2027-01-03", end: "2027-01-04", qty: 7 }], "2027-01-01", "2027-01-04")).toBe(7);
    expect(maximumReserved([{ start: "2027-01-01", end: "2027-01-03", qty: 5 }, { start: "2027-01-03", end: "2027-01-04", qty: 7 }], "2027-01-01", "2027-01-04")).toBe(12);
  });
  it("baixa parcial é idempotente e não permite exceder o saldo nem simular pagamento do provedor", async () => {
    const { entry } = await createFinancialEntry(identity, { direction: "receber", customerId, description: "Conta", dueDate: "2027-01-01", amountCents: 10000 });
    const input = { entryId: entry.id, amountCents: 3000, method: "pix", idempotencyKey: randomUUID() };
    await settleEntry(identity, input); expect((await settleEntry(identity, input)).duplicated).toBe(true);
    await expect(settleEntry(identity, { ...input, amountCents: 7001, idempotencyKey: randomUUID() })).rejects.toThrow("excede");
    await expect(settleEntry(identity, { ...input, method: "pagbank", idempotencyKey: randomUUID() })).rejects.toThrow("exclusivamente");
    expect((await financeData(identity, new URLSearchParams())).entries[0].balanceCents).toBe(7000);
    expect(await db.select().from(schema.settlements)).toHaveLength(1);
  });
  it("duas baixas concorrentes não ultrapassam o saldo", async () => {
    const { entry } = await createFinancialEntry(identity, { direction: "pagar", description: "Despesa", dueDate: "2027-01-01", amountCents: 10000 });
    const results = await Promise.allSettled([1, 2].map(() => settleEntry(identity, { entryId: entry.id, amountCents: 7000, method: "dinheiro", idempotencyKey: randomUUID() })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await financeData(identity, new URLSearchParams())).entries[0].balanceCents).toBe(3000);
  });
  it("avarias ficam indisponíveis e reparo libera somente a quantidade reparada", async () => {
    const { order, item } = await openOrder(10);
    await registerReturn(req({ lines: [{ orderItemId: item.id, qtyGood: 6, qtyDamaged: 2 }], idempotencyKey: randomUUID() }), params(order.id));
    let available = (await periodAvailability(identity, "2027-02-11", "2027-02-11"))[0];
    expect(available).toMatchObject({ stockQty: 200, unavailableQty: 2, reserved: 2, available: 196 });
    await moveStock(identity, { catalogItemId: catalogId, kind: "reparo", quantity: 1, reason: "Reparo conferido" });
    available = (await periodAvailability(identity, "2027-02-11", "2027-02-11"))[0]; expect(available.available).toBe(197);
    await expect(moveStock(identity, { catalogItemId: catalogId, kind: "reparo", quantity: 2, reason: "Excesso" })).rejects.toThrow("excede");
  });
  it("reabertura preserva recebimentos e novo fechamento gera só a diferença ou reembolso", async () => {
    const { order, item } = await openOrder(10);
    await close(req({ confirmedMissingQty: 10 }), params(order.id));
    let finance = await financeData(identity, new URLSearchParams());
    await settleEntry(identity, { entryId: finance.entries[0].id, amountCents: 3000, method: "pix", idempotencyKey: randomUUID() });
    await reopen(req({ reason: "Retorno adicional" }), params(order.id));
    await registerReturn(req({ lines: [{ orderItemId: item.id, qtyGood: 8, qtyDamaged: 0 }], idempotencyKey: randomUUID() }), params(order.id));
    await close(req({ confirmedMissingQty: 2 }), params(order.id));
    finance = await financeData(identity, new URLSearchParams());
    expect(finance.totals.receber).toBe(0); expect(finance.totals.pagar).toBe(600);
    expect(finance.settlements.reduce((a, s) => a + s.amountCents, 0)).toBe(3000);
    const [itemNow] = await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, catalogId)); expect(itemNow.stockQty).toBe(198);
  });
  it("não conclui entrega sem saída ou coleta sem devolução", async () => {
    const { order } = await openOrder(10);
    const { task } = await createLogisticsTask(identity, { orderId: order.id, kind: "entrega", scheduledAt: "2027-02-10T12:00:00Z", address: "Endereço de teste" });
    await expect(updateLogisticsTask(identity, { id: task.id, status: "concluida" })).rejects.toThrow("Confirme");
    await db.update(schema.orders).set({ exitConfirmedAt: new Date() }).where(eq(schema.orders.id, order.id));
    expect((await updateLogisticsTask(identity, { id: task.id, status: "concluida" })).task.status).toBe("concluida");
    const pickup = await createLogisticsTask(identity, { orderId: order.id, kind: "coleta", scheduledAt: "2027-02-12T12:00:00Z", address: "Endereço de teste" });
    await expect(updateLogisticsTask(identity, { id: pickup.task.id, status: "concluida" })).rejects.toThrow("devoluções");
  });
  it("não expõe loja desativada, dados internos ou páginas não publicadas", async () => {
    await saveSettings(identity, { slug: "loja-teste", storefront: { enabled: false, title: "Teste" } });
    await expect(publicStore("loja-teste")).rejects.toThrow("não encontrada");
    await saveSettings(identity, { storefront: { enabled: true } });
    await db.update(schema.catalogItems).set({ published: true, rentalPriceCents: 500 }).where(eq(schema.catalogItems.id, catalogId));
    const store = await publicStore("loja-teste"); expect(store.products).toHaveLength(1); expect(store.products[0]).not.toHaveProperty("stockQty"); expect(store.products[0]).not.toHaveProperty("replacementCents");
    await savePage(identity, { slug: "sobre", title: "Sobre", content: "Texto real cadastrado", published: false });
    await expect(publicPage("loja-teste", "sobre")).rejects.toThrow("não encontrada");
  });
  it("solicitação pública persiste uma vez e não cria contrato ou pagamento fictício", async () => {
    await saveSettings(identity, { slug: "loja-teste", storefront: { enabled: true } });
    await db.update(schema.catalogItems).set({ published: true }).where(eq(schema.catalogItems.id, catalogId));
    const input = { kind: "orcamento", name: "Visitante", email: "visitor@example.test", phone: "71999999999", eventDate: "2027-04-01", returnDueDate: "2027-04-02", items: [{ catalogItemId: catalogId, qty: 5 }], consent: true, requestKey: randomUUID() };
    const first = await submitLead("loja-teste", input); expect((await submitLead("loja-teste", input)).protocol).toBe(first.protocol);
    expect(await db.select().from(schema.storeLeads)).toHaveLength(1); expect(await db.select().from(schema.rentalDocuments)).toHaveLength(0);
    expect(await db.select().from(schema.financialEntries)).toHaveLength(0);
    await expect(submitLead("loja-teste", { ...input, requestKey: randomUUID(), items: [{ catalogItemId: foreignCatalogId, qty: 1 }] })).rejects.toThrow("indisponível");
  });
  it("link compartilhado expira, revoga anterior e aceite não finge assinatura", async () => {
    const { document } = await configuredQuote();
    const first = await shareDocument(identity, { id: document.id }); const token = first.path.split("/").pop()!;
    expect((await sharedDocument(token)).number).toBe(document.number);
    await acceptSharedQuote(token);
    const [saved] = await db.select().from(schema.rentalDocuments).where(eq(schema.rentalDocuments.id, document.id)); expect(saved.status).toBe("aceito"); expect(saved.signedAt).toBeNull();
    await shareDocument(identity, { id: document.id }); await expect(sharedDocument(token)).rejects.toThrow("expirado");
  });
  it("credenciais ficam criptografadas e não voltam à interface", async () => {
    await saveSettings(identity, { secrets: { pagbankToken: "test-secret-only" } });
    const data = await settingsData(identity); expect(data.secretStatus.pagbankToken).toBe(true); expect(JSON.stringify(data)).not.toContain("test-secret-only");
    const [saved] = await db.select().from(schema.companySettings); expect(saved.encryptedSecrets).not.toContain("test-secret-only"); expect(JSON.parse(decrypt(saved.encryptedSecrets!)).pagbankToken).toBe("test-secret-only");
  });
  it("sem configuração, integrações retornam pendência e não geram confirmações", async () => {
    const { document: quote } = await configuredQuote();
    const contract = await convertToContract(identity, { id: quote.id, installments: [{ dueDate: "2027-01-01", amountCents: quote.totalCents }] });
    const [entry] = await db.select().from(schema.financialEntries);
    await expect(createCheckout(identity, { entryId: entry.id })).rejects.toThrow("configuração");
    await expect(requestSignature(identity, { id: contract.document.id })).rejects.toThrow("configuração");
    await expect(sendDocument(identity, { id: quote.id, channel: "email", requestKey: randomUUID() })).rejects.toThrow("configuração");
    expect(await db.select().from(schema.settlements)).toHaveLength(0); expect(await db.select().from(schema.paymentCheckouts)).toHaveLength(0); expect(await db.select().from(schema.messageLog)).toHaveLength(0);
  }, 30000);
  it("notificação PagBank exige assinatura, valor, referência e moeda corretos", async () => {
    await saveSettings(identity, { secrets: { pagbankToken: "webhook-test-token" } });
    const { entry } = await createFinancialEntry(identity, { direction: "receber", description: "Teste webhook", dueDate: "2027-01-01", amountCents: 10000 });
    const [checkout] = await db.insert(schema.paymentCheckouts).values({ companyId: companyA, entryId: entry.id, amountCents: 10000, status: "ativo", createdBy: identity.id }).returning();
    const raw = JSON.stringify({ reference_id: checkout.id, charges: [{ id: "CHAR-test", status: "PAID", paid_at: new Date().toISOString(), amount: { value: 10000, currency: "BRL" } }] });
    const signature = createHash("sha256").update(`webhook-test-token-${raw}`).digest("hex");
    expect(authenticPagbankPayload("webhook-test-token", raw, signature)).toBe(true);
    await expect(pagbankWebhook(checkout.id, raw, "fake")).rejects.toThrow(); expect(await db.select().from(schema.settlements)).toHaveLength(0);
    expect((await pagbankWebhook(checkout.id, raw, signature)).confirmed).toBe(true);
    await pagbankWebhook(checkout.id, raw, signature); expect(await db.select().from(schema.settlements)).toHaveLength(1);
  });
  it("API recusa operadores nos módulos não autorizados e protege dados de outra empresa", async () => {
    identity.role = "operador";
    const context = { params: Promise.resolve({ module: "financeiro" }) };
    expect((await managementGet(req(), context)).status).toBe(403); expect((await managementPost(req({ action: "criar" }), context)).status).toBe(403);
    identity.role = "gestor";
    await expect(moveStock(identity, { catalogItemId: foreignCatalogId, kind: "entrada", quantity: 1, reason: "Invasão negada" })).rejects.toThrow("não encontrado");
  });
  it("backup é criptografado, validado e contém somente dados da empresa", async () => {
    const { document: quote } = await configuredQuote();
    await convertToContract(identity, { id: quote.id, installments: [{ dueDate: "2027-06-01", amountCents: quote.totalCents }] });
    const [account] = await db.select().from(schema.financialEntries);
    await settleEntry(identity, { entryId: account.id, amountCents: 1000, method: "pix", idempotencyKey: randomUUID() });
    const result = await createBackup(identity); const content = await downloadBackup(identity, result.id);
    expect(content.toString()).not.toContain("Cliente de teste"); expect(createHash("sha256").update(content).digest("hex")).toBe(result.checksum);
    const restored = decodeBackup(content.toString()); expect(restored.companyId).toBe(companyA);
    expect(restored.tables.catalog_items).toHaveLength(1); expect(restored.tables.catalog_items[0].id).toBe(catalogId);
    expect(restored.tables.companies).toHaveLength(1); expect(restored.tables.companies[0].id).toBe(companyA);
    expect(() => decodeBackup(content.toString().slice(0, -4) + "xxxx")).toThrow();
    await client.exec("TRUNCATE companies, users CASCADE");
    await restoreTables(restored, async (query, params) => client.query(query, params));
    const recovered = await financeData(identity, new URLSearchParams());
    expect(recovered.entries[0].balanceCents).toBe(5100); expect(recovered.settlements).toHaveLength(1);
    expect(await db.select().from(schema.rentalDocuments)).toHaveLength(2);
  }, 30000);
  it("cancelar contrato sem saída libera a reserva e cancela as parcelas", async () => {
    const { document: quote } = await configuredQuote(); const contract = await convertToContract(identity, { id: quote.id, installments: [{ dueDate: "2027-01-01", amountCents: quote.totalCents }] });
    await cancelDocument(identity, { id: contract.document.id, reason: "Cliente cancelou antes da saída" });
    expect((await periodAvailability(identity, "2027-06-11", "2027-06-11"))[0].available).toBe(200);
    expect((await financeData(identity, new URLSearchParams())).totals.receber).toBe(0);
    expect((await (await metrics()).json()).statusSeries).toContainEqual({ name: "Cancelados", value: 1 });
  });
});
afterAll(async () => { await client?.close(); });

describe("fluxos reais de API e banco isolado", () => {
  it("grava pedido, saída, duas devoluções, fechamento, ajuste, baixa e reabertura", async () => {
    const created = await createOrder(req(payload()));
    expect(created.status).toBe(200);
    const { order } = await created.json();
    const before = await (await detail(req(), params(order.id))).json();
    const itemId = before.items[0].id;
    expect((await exit(req({ lines: [{ orderItemId: itemId, qtyDelivered: 118 }] }), params(order.id))).status).toBe(200);
    expect((await registerReturn(req({ lines: [{ orderItemId: itemId, qtyGood: 100, qtyDamaged: 2 }], idempotencyKey: randomUUID() }), params(order.id))).status).toBe(200);
    expect((await registerReturn(req({ lines: [{ orderItemId: itemId, qtyGood: 10, qtyDamaged: 0 }], idempotencyKey: randomUUID() }), params(order.id))).status).toBe(200);
    const closed = await close(req({ confirmedMissingQty: 6 }), params(order.id));
    expect(closed.status).toBe(200);
    expect((await closed.json()).closure.suggestedCents).toBe(9600);
    const adjusted = await billing(req({ action: "adjust", adjustmentCents: 1200, reason: "Ajuste de auditoria" }), params(order.id));
    expect(adjusted.status).toBe(200);
    expect((await adjusted.json()).closure.finalCents).toBe(8400);
    expect((await billing(req({ action: "status", status: "recebida" }), params(order.id))).status).toBe(200);
    const reopened = await reopen(req({ reason: "Conferência adicional" }), params(order.id));
    expect(reopened.status).toBe(200);
    expect((await reopened.json()).priorReceivedCents).toBe(8400);
    const final = await (await detail(req(), params(order.id))).json();
    expect(final.order.status).toBe("aberto");
    expect(final.returns).toHaveLength(2);
    expect(final.balances[0]).toMatchObject({ qtyDelivered: 118, qtyGood: 110, qtyDamaged: 2, qtyOpen: 6 });
  });

  it("nega cadastro e fechamento a operador e oculta pedidos de outra empresa", async () => {
    const { order } = await openOrder();
    identity.role = "operador";
    expect((await team()).status).toBe(403);
    expect((await createCatalog(req({ name: "Proibido", unit: "un", replacementCents: 100 }))).status).toBe(403);
    expect((await close(req({ confirmedMissingQty: 10 }), params(order.id))).status).toBe(403);
    identity.companyId = companyB;
    expect((await detail(req(), params(order.id))).status).toBe(404);
    expect((await (await listOrders(req())).json()).orders).toEqual([]);
  });

  it("rejeita item de catálogo de outra empresa antes de gravar o pedido", async () => {
    const response = await createOrder(req(payload({ items: [{ catalogItemId: foreignCatalogId, name: "Indevido", unit: "un", qtyPlanned: 1 }] })));
    expect(response.status).toBe(400);
    expect(await db.select().from(schema.orders)).toHaveLength(0);
  });

  it("rejeita data inexistente e devolução anterior ao evento", async () => {
    for (const dates of [{ eventDate: "2027-02-30" }, { returnDueDate: "2027-02-09" }]) {
      const response = await createOrder(req(payload(dates)));
      expect(response.status).toBe(400);
    }
    expect(await db.select().from(schema.orders)).toHaveLength(0);
  });

  it("reenvio de devolução não duplica e chave de outro pedido não reutiliza o registro", async () => {
    const first = await openOrder();
    const second = await openOrder();
    const key = randomUUID();
    const body = { lines: [{ orderItemId: first.item.id, qtyGood: 2, qtyDamaged: 0 }], idempotencyKey: key };
    const one = await registerReturn(req(body), params(first.order.id));
    const again = await registerReturn(req(body), params(first.order.id));
    expect(one.status).toBe(200);
    expect((await again.json()).duplicated).toBe(true);
    const collision = await registerReturn(req({ ...body, lines: [{ orderItemId: second.item.id, qtyGood: 2, qtyDamaged: 0 }] }), params(second.order.id));
    expect(collision.status).toBe(400);
    expect(await db.select().from(schema.returns)).toHaveLength(1);
  });

  it("não aceita devolução além do entregue, inclusive em duas submissões simultâneas", async () => {
    const { order, item } = await openOrder(10);
    const responses = await Promise.all([1, 2].map(() => registerReturn(req({ lines: [{ orderItemId: item.id, qtyGood: 7, qtyDamaged: 0 }], idempotencyKey: randomUUID() }), params(order.id))));
    expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
    const result = await (await detail(req(), params(order.id))).json();
    expect(result.balances[0].qtyOpen).toBe(3);
  });

  it("mede uma saída uma única vez mesmo com duas devoluções parciais", async () => {
    const { order, item } = await openOrder(10);
    for (const qty of [2, 3]) {
      expect((await registerReturn(req({ lines: [{ orderItemId: item.id, qtyGood: qty, qtyDamaged: 0 }] }), params(order.id))).status).toBe(200);
    }
    const data = await (await metrics()).json();
    expect(data.topItems[0]).toMatchObject({ entregues: 10, devolvidos: 5 });
  });

  it("conta uma devolução com dois itens como um retorno no dia local da empresa", async () => {
    const { order, item } = await openOrder();
    const [second] = await db.insert(schema.orderItems).values({ orderId: order.id, name: "Prato", qtyPlanned: 10, qtyDelivered: 10 }).returning();
    const at = new Date(); at.setUTCHours(1, 30, 0, 0);
    const [ret] = await db.insert(schema.returns).values({ orderId: order.id, companyId: companyA, createdBy: identity.id, occurredAt: at }).returning();
    await db.insert(schema.returnItems).values([{ returnId: ret.id, orderItemId: item.id, qtyGood: 3, qtyDamaged: 0 }, { returnId: ret.id, orderItemId: second.id, qtyGood: 4, qtyDamaged: 0 }]);
    const data = await (await metrics()).json();
    const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: identity.timezone }).format(at).slice(5);
    expect(data.returnsSeries.find((r: { day: string }) => r.day === localDay)).toMatchObject({ devolucoes: 1, unidades: 7 });
  });

  it("não registra recebimento sem fechamento", async () => {
    const { order } = await openOrder();
    expect((await billing(req({ action: "status", status: "recebida" }), params(order.id))).status).toBe(400);
    expect(await db.select().from(schema.billingEvents)).toHaveLength(0);
  });

  it("repetir a mesma baixa não duplica o recebimento", async () => {
    const { order } = await openOrder();
    expect((await close(req({ confirmedMissingQty: 10 }), params(order.id))).status).toBe(200);
    for (let i = 0; i < 2; i++) expect((await billing(req({ action: "status", status: "recebida" }), params(order.id))).status).toBe(200);
    const events = await db.select().from(schema.billingEvents).where(and(eq(schema.billingEvents.orderId, order.id), eq(schema.billingEvents.status, "recebida")));
    expect(events).toHaveLength(1);
    const result = await reopen(req({ reason: "Conferir saldo" }), params(order.id));
    expect((await result.json()).priorReceivedCents).toBe(12000);
  });

  it("um ajuste que zera a cobrança não deixa valor zero como pendente", async () => {
    const { order } = await openOrder(1);
    await close(req({ confirmedMissingQty: 1 }), params(order.id));
    expect((await billing(req({ action: "adjust", adjustmentCents: 1200, reason: "Abatimento total" }), params(order.id))).status).toBe(200);
    const data = await (await detail(req(), params(order.id))).json();
    expect(data.order.billingStatus).toBe("sem_cobranca");
    expect(data.closure.finalCents).toBe(0);
  });
});
