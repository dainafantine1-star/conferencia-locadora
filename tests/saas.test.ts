import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
const authState = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }));
const smtp = vi.hoisted(() => ({ fail: false, sent: [] as { to: string; text: string }[] }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: async (message: { to: string; text: string }) => { smtp.sent.push(message); if (smtp.fail) throw new Error("Controlled SMTP timeout"); return { accepted: [message.to], messageId: "controlled-weekly-id" }; } }) } }));
vi.mock("@/lib/auth/options", () => ({ auth: async () => ({ user: authState.user }), unstable_update: vi.fn() }));
vi.mock("@/lib/db", async () => { const { PGlite } = await import("@electric-sql/pglite"); const { drizzle } = await import("drizzle-orm/pglite"); const schema = await import("@/lib/db/schema"); const client = new PGlite(); return { db: drizzle(client, { schema }), client }; });
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { requireSession, type SessionUser } from "@/lib/auth/session";
import { registerCompany, inviteMember, acceptInvite, inviteInfo, revokeInvite, updateAccess, accountMembers } from "@/lib/saas/accounts";
import { assertFeature, accountContext, entitlement } from "@/lib/saas/access";
import { platformData, savePlan, assignSubscription } from "@/lib/saas/platform";
import { allFeatures, openLimits } from "@/lib/saas/catalog";
import { createCustomer, updateCustomer } from "@/lib/erp/customer";
import { createRentalOrder } from "@/lib/erp/orders";
import { createQuote, convertToContract, reserveQuote, releaseQuote } from "@/lib/erp/commercial";
import { NextRequest } from "next/server";
import { POST as exitOrder } from "@/app/api/pedidos/[id]/saida/route";
import { registerReturn } from "@/lib/business/returns";
import { closeOrder } from "@/lib/business/closures";
import { settleEntry, financeData } from "@/lib/erp/finance";
import { saveRecord, bookVenue, productData, importParticipants, scanParticipant, participantQr, createPortal, portalData, revokePortal, completeTraining, recordDocumentVisit } from "@/lib/saas/product";
import { shareDocument } from "@/lib/erp/commercial";
import { createBackup, decodeBackup, downloadBackup } from "@/lib/erp/backup";
import { putPrivateFile, getPrivateFile } from "@/lib/storage";
import { provisionPlatformAdmin, activationInfo, activatePlatform } from "@/lib/saas/activation";
import { isPlatformAdmin } from "@/lib/saas/platform";
import { weeklyReports } from "@/lib/saas/weekly";
import { encrypt } from "@/lib/erp/crypto";
import { GET as metricsGet } from "@/app/api/metricas/route";
import { GET as dashboardGet } from "@/app/api/painel/route";
import { POST as scanLabel } from "@/app/api/pedidos/[id]/bipagem/route";
import { syncSignature } from "@/lib/erp/integrations";
import { POST as attachProof } from "@/app/api/produto/financeiro/comprovante/route";
let client: PGlite; let a: SessionUser; let b: SessionUser;
const password = "test-only-password-strong-123";
beforeAll(async () => { client = (await import("@/lib/db") as unknown as { client: PGlite }).client; for (const f of readdirSync("drizzle").filter(f => f.endsWith(".sql")).sort()) await client.exec(readFileSync(`drizzle/${f}`, "utf8")); }, 120000);
beforeEach(async () => {
  smtp.fail = false; smtp.sent = [];
  process.env.APP_ENCRYPTION_KEY = "saas-test-key-only-32-characters-long"; process.env.BACKUP_DIR = ".data/saas-tests/backups"; process.env.STORAGE_DIR = ".data/saas-tests/files"; process.env.STORAGE_PROVIDER = "local";
  await client.exec("TRUNCATE companies, users CASCADE"); await db.update(s.saasPlans).set({ features: allFeatures(), limits: openLimits() });
  const first = await registerCompany({ company: "Locadora A", name: "Proprietário A", email: "a@example.test", password, planId: "essencial" });
  const second = await registerCompany({ company: "Locadora B", name: "Proprietário B", email: "b@example.test", password, planId: "plus" });
  a = { id: first.user.id, companyId: first.company.id, companyName: "Locadora A", name: "A", email: first.user.email, role: "gestor", accountRole: "owner", timezone: "America/Bahia" };
  b = { ...a, id: second.user.id, companyId: second.company.id, companyName: "Locadora B", email: second.user.email };
  authState.user = { ...a, authVersion: 1 };
});
afterAll(async () => { await client?.close(); });
async function event(user = a, qty = 1) { const c = await createCustomer(user, { name: "Cliente " + user.name }); const [item] = await db.insert(s.catalogItems).values({ companyId: user.companyId, name: "Cadeira", replacementCents: 10000, stockQty: 1 }).returning(); const order = await createRentalOrder(user, { customerId: c.customer.id, eventName: "Festa", eventDate: "2027-01-10", returnDueDate: "2027-01-11", items: [{ catalogItemId: item.id, name: item.name, unit: "un", qtyPlanned: qty }] }); return { customer: c.customer, item, order: order.order }; }
describe("base SaaS real com duas empresas", () => {
  it("comprovantes rejeitam origem externa e conteúdo acima do limite antes de gravar", async () => {
    expect((await attachProof(new NextRequest("http://localhost/api/proof", { method: "POST", headers: { origin: "https://externo.example.test", host: "localhost" }, body: "" }))).status).toBe(403);
    expect((await attachProof(new NextRequest("http://localhost/api/proof", { method: "POST", headers: { "content-length": "6000000" }, body: "" }))).status).toBe(413);
    expect(await db.select().from(s.productRecords).where(eq(s.productRecords.module, "comprovantes"))).toHaveLength(0);
  });
  it("painel oculta valores sem permissão financeira e bloqueia consulta sem devoluções", async () => {
    await db.update(s.memberships).set({ role: "operador", accountRole: "member", grants: { returns: ["view"] } }).where(and(eq(s.memberships.userId, a.id), eq(s.memberships.companyId, a.companyId)));
    const metrics = await metricsGet(); expect(metrics.status).toBe(200); const data = await metrics.json(); expect(data.revenue).toBeNull(); expect(data.billingSeries).toEqual([]);
    const dashboard = await dashboardGet(); expect(dashboard.status).toBe(200); expect((await dashboard.json()).pendingBilling).toEqual([]);
    await db.update(s.saasPlans).set({ features: { ...allFeatures(), returns: false } }).where(eq(s.saasPlans.id, "essencial"));
    expect((await metricsGet()).status).toBe(403); expect((await dashboardGet()).status).toBe(403);
    expect((await scanLabel(new NextRequest("http://localhost/api/scan", { method: "POST", body: JSON.stringify({ code: "TESTE", context: "retorno" }) }), { params: Promise.resolve({ id: randomUUID() }) })).status).toBe(403);
  });
  it("link externo autoriza só o documento compartilhado mesmo após a saída do autor", async () => {
    const customer = (await createCustomer(a, { name: "Cliente externo" })).customer;
    const quote = (await createQuote(a, { customerId: customer.id, eventName: "Evento externo", eventDate: "2027-01-10", returnDueDate: "2027-01-11", lines: [{ catalogItemId: null, name: "Item", unit: "un", qty: 1, priceCents: 1000, periods: 1 }] })).document;
    const shared = await shareDocument(a, { id: quote.id }); const token = shared.path.split("/").pop()!;
    await db.update(s.memberships).set({ active: false }).where(and(eq(s.memberships.userId, a.id), eq(s.memberships.companyId, a.companyId)));
    await expect(syncSignature(a, { id: quote.id }, token)).rejects.toMatchObject({ status: 503 });
    await expect(syncSignature(a, { id: quote.id })).rejects.toMatchObject({ status: 403 });
    await expect(syncSignature(a, { id: randomUUID() }, token)).rejects.toMatchObject({ status: 403 });
  });
  it("relatório semanal envia só na segunda, usa tarefas públicas e não duplica", async () => {
    const { order, customer } = await event(); await db.update(s.customers).set({ email: "client@example.test" }).where(eq(s.customers.id, customer.id));
    await db.insert(s.companySettings).values({ companyId: a.companyId, preferences: { publicUrl: "https://example.test" }, integrations: { smtpHost: "smtp.invalid", smtpPort: 587, smtpUser: "test", mailFrom: "test@example.test" }, encryptedSecrets: encrypt(JSON.stringify({ smtpPassword: "test-only" })) });
    await saveRecord(a, "eventos", { title: "Semana", orderId: order.id, data: { tasks: [{ name: "Tarefa pública", dueDate: "2026-11-16", done: false, clientVisible: true }, { name: "Segredo interno", dueDate: "2026-11-16", done: false, clientVisible: false }] } });
    await createPortal(a, { customerId: customer.id, orderIds: [order.id] }); await weeklyReports(new Date("2026-11-15T12:00:00Z")); expect(smtp.sent).toHaveLength(0);
    const first = await weeklyReports(new Date("2026-11-16T12:00:00Z")); expect(first.results[0].status).toBe("aceito_smtp"); await weeklyReports(new Date("2026-11-16T13:00:00Z")); expect(smtp.sent).toHaveLength(1); expect(smtp.sent[0].text).toContain("Tarefa pública"); expect(smtp.sent[0].text).not.toContain("Segredo interno");
  });
  it("relatório semanal mantém envio incerto para conferência e não repete", async () => {
    const { order, customer } = await event(); await db.update(s.customers).set({ email: "client@example.test" }).where(eq(s.customers.id, customer.id));
    await db.insert(s.companySettings).values({ companyId: a.companyId, preferences: { publicUrl: "https://example.test" }, integrations: { smtpHost: "smtp.invalid", smtpPort: 587, smtpUser: "test", mailFrom: "test@example.test" }, encryptedSecrets: encrypt(JSON.stringify({ smtpPassword: "test-only" })) });
    await createPortal(a, { customerId: customer.id, orderIds: [order.id] }); smtp.fail = true;
    expect((await weeklyReports(new Date("2026-11-16T12:00:00Z"))).results[0].status).toBe("incerto"); await weeklyReports(new Date("2026-11-16T13:00:00Z")); expect(smtp.sent).toHaveLength(1);
  });
  it("ativação administrativa exige link de uso único e senha definida pelo titular", async () => { const setup = await provisionPlatformAdmin("admin-new@example.test"); const token = setup.path.split("/").pop()!; const info = await activationInfo(token); expect(await isPlatformAdmin(info.userId)).toBe(false); await expect(activatePlatform(token, { password: "curta" })).rejects.toThrow(); await activatePlatform(token, { password }); expect(await isPlatformAdmin(info.userId)).toBe(true); await expect(activatePlatform(token, { password })).rejects.toMatchObject({ status: 410 }); });
  it("reemitir ativação administrativa invalida o link anterior", async () => { const first = await provisionPlatformAdmin("admin-new@example.test"); const next = await provisionPlatformAdmin("admin-new@example.test"); await expect(activationInfo(first.path.split("/").pop()!)).rejects.toMatchObject({ status: 410 }); expect((await activationInfo(next.path.split("/").pop()!)).email).toBe("admin-new@example.test"); });
  it("cadastra proprietário e planos com recursos iguais, Essencial 50 e Plus pendente", async () => { const aa = await entitlement(a.companyId), bb = await entitlement(b.companyId); expect(aa.plan.monthlyCents).toBe(5000); expect(bb.plan.monthlyCents).toBeNull(); expect(aa.plan.features).toEqual(bb.plan.features); expect(aa.plan.limits).toEqual(openLimits()); const context = await accountContext(a); expect(context.accounts).toHaveLength(1); expect(context.accounts[0].accountRole).toBe("owner"); });
  it("cadastro duplicado não deixa empresa órfã", async () => { await expect(registerCompany({ company: "Indevida", name: "Nome", email: a.email, password })).rejects.toMatchObject({ status: 409 }); expect(await db.select().from(s.companies)).toHaveLength(2); });
  it("sessão recarrega vínculo e revoga acesso somente à empresa alterada", async () => { await db.insert(s.memberships).values({ userId: a.id, companyId: b.companyId, role: "operador" }); expect((await requireSession()).user.accountRole).toBe("owner"); await db.update(s.memberships).set({ active: false }).where(and(eq(s.memberships.companyId, a.companyId), eq(s.memberships.userId, a.id))); await expect(requireSession()).rejects.toMatchObject({ status: 401 }); authState.user = { ...a, companyId: b.companyId, authVersion: 1 }; expect((await requireSession()).user.companyId).toBe(b.companyId); });
  it("não confia em empresa ou authVersion forjada na sessão", async () => { authState.user = { ...a, companyId: b.companyId, authVersion: 1 }; await expect(requireSession()).rejects.toMatchObject({ status: 401 }); authState.user = { ...a, authVersion: 99 }; await expect(requireSession()).rejects.toMatchObject({ status: 401 }); });
  it("convite de conta existente exige senha própria e permite duas empresas", async () => { const invite = await inviteMember(a, { email: b.email, accountRole: "member", permissions: ["clientes"] }); expect((await inviteInfo(invite.token)).companyId).toBe(a.companyId); await expect(acceptInvite(invite.token, { email: b.email, name: "Conta B", password: "wrong-password-12345" })).rejects.toMatchObject({ status: 403 }); await acceptInvite(invite.token, { email: b.email, name: "Conta B", password }); expect((await accountContext(b)).accounts).toHaveLength(2); await expect(acceptInvite(invite.token, { email: b.email, name: "Conta B", password })).rejects.toMatchObject({ status: 410 }); });
  it("convite não armazena token original e pode ser revogado", async () => { const invite = await inviteMember(a, { email: "novo@example.test", accountRole: "member" }); const [row] = await db.select().from(s.companyInvites); expect(row.tokenHash).not.toBe(invite.token); await revokeInvite(a, { id: invite.id }); await expect(inviteInfo(invite.token)).rejects.toMatchObject({ status: 410 }); });
  it("convite rejeita e-mail divergente e prazo expirado", async () => { const invite = await inviteMember(a, { email: "novo@example.test", accountRole: "member" }); await expect(acceptInvite(invite.token, { email: b.email, name: "Nome", password })).rejects.toMatchObject({ status: 403 }); await db.update(s.companyInvites).set({ expiresAt: new Date(0) }).where(eq(s.companyInvites.id, invite.id)); await expect(inviteInfo(invite.token)).rejects.toMatchObject({ status: 410 }); });
  it("cota de usuários conta convites pendentes e bloqueia concorrência", async () => { await db.update(s.saasPlans).set({ limits: { ...openLimits(), users: 2 } }).where(eq(s.saasPlans.id, "essencial")); const results = await Promise.allSettled([inviteMember(a, { email: "x@example.test", accountRole: "member" }), inviteMember(a, { email: "y@example.test", accountRole: "member" })]); expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); });
  it("desliga clientes no Essencial sem afetar Plus nem apagar registros", async () => { await createCustomer(a, { name: "Preservado" }); await db.update(s.saasPlans).set({ features: { ...allFeatures(), customers: false } }).where(eq(s.saasPlans.id, "essencial")); await expect(createCustomer(a, { name: "Bloqueado" })).rejects.toMatchObject({ status: 403 }); expect((await createCustomer(b, { name: "Permitido Plus" })).customer.name).toBe("Permitido Plus"); expect(await db.select().from(s.customers).where(eq(s.customers.companyId, a.companyId))).toHaveLength(1); });
  it("permissão de criar não autoriza editar nem dados financeiros", async () => { const invite = await inviteMember(a, { email: b.email, accountRole: "member", grants: { customers: ["view", "create"] } }); await acceptInvite(invite.token, { email: b.email, name: "Conta B", password }); const actor = { ...b, companyId: a.companyId, role: "operador" as const, accountRole: "member" as const }; const c = await createCustomer(actor, { name: "Permitido" }); await expect(updateCustomer(actor, { id: c.customer.id, name: "Proibido" })).rejects.toMatchObject({ status: 403 }); await expect(assertFeature(actor, "finance", "financial")).rejects.toMatchObject({ status: 403 }); });
  it("administrador de locadora não administra preços da Detali", async () => { await expect(platformData(a)).rejects.toMatchObject({ status: 403 }); await db.insert(s.platformAdmins).values({ userId: a.id }); const data = await platformData(a); expect(data.companies).toHaveLength(2); await savePlan(a, { ...data.plans[0], monthlyCents: 6000 }); expect((await platformData(a)).audit).toHaveLength(1); });
  it("assinatura manual não gera cobrança e atraso bloqueia só novas operações", async () => { await db.insert(s.platformAdmins).values({ userId: a.id }); const result = await assignSubscription(a, { companyId: a.companyId, planId: "essencial", status: "past_due", cycle: "monthly", startsAt: new Date().toISOString(), endsAt: null }); expect(result.billing).toContain("Nenhuma cobrança"); await assertFeature(a, "customers", "view"); await expect(createCustomer(a, { name: "Pendente" })).rejects.toMatchObject({ status: 403 }); });
  it("impede remover o último proprietário e limita mudanças ao tenant", async () => { await expect(updateAccess(a, { userId: a.id, accountRole: "member", active: false })).rejects.toThrow(); await expect(updateAccess(a, { userId: b.id, accountRole: "member", active: true })).rejects.toMatchObject({ status: 404 }); expect((await accountMembers(a)).members).toHaveLength(1); });
  it("banco rejeita referência cruzada mesmo sem passar pelo serviço", async () => { const customer = (await createCustomer(b, { name: "B" })).customer; await expect(db.insert(s.orders).values({ companyId: a.companyId, customerId: customer.id, eventName: "Invasão", eventDate: "2027-01-01", returnDueDate: "2027-01-02", number: 1, createdBy: a.id })).rejects.toThrow(); });
  it("duas reservas simultâneas não deixam disponibilidade negativa", async () => { const c = (await createCustomer(a, { name: "Cliente" })).customer; const [item] = await db.insert(s.catalogItems).values({ companyId: a.companyId, name: "Única cadeira", stockQty: 1, replacementCents: 1000 }).returning(); const payload = { customerId: c.id, eventName: "Concorrente", eventDate: "2027-02-01", returnDueDate: "2027-02-02", items: [{ catalogItemId: item.id, name: item.name, unit: "un", qtyPlanned: 1 }] }; const results = await Promise.allSettled([createRentalOrder(a, payload), createRentalOrder(a, payload)]); expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); });
  it("locais bloqueiam sobreposição no mesmo espaço e permitem espaços diferentes", async () => { const { order } = await event(); const v1 = (await saveRecord(a, "locais", { title: "Salão A", data: { address: "Rua A", capacity: 100 } })).record; const v2 = (await saveRecord(a, "locais", { title: "Salão B", data: { address: "Rua B", capacity: null } })).record; const payload = { venueId: v1.id, orderId: order.id, startsAt: "2027-01-10T10:00:00.000Z", endsAt: "2027-01-10T20:00:00.000Z" }; await bookVenue(a, payload); await expect(bookVenue(a, payload)).rejects.toMatchObject({ status: 409 }); await bookVenue(a, { ...payload, venueId: v2.id }); });
  it("cota de locais é transacional", async () => { await db.update(s.saasPlans).set({ limits: { ...openLimits(), venues: 1 } }).where(eq(s.saasPlans.id, "essencial")); const payload = { title: "Espaço", data: { address: "Rua", capacity: null } }; const results = await Promise.allSettled([saveRecord(a, "locais", payload), saveRecord(a, "locais", payload)]); expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); });
  it("importação e entrada por QR usam a mesma cota sem duplicar recargas", async () => { const { order } = await event(); await db.update(s.saasPlans).set({ limits: { ...openLimits(), checkins_month: 2 } }).where(eq(s.saasPlans.id, "essencial")); const data = { orderId: order.id, source: "import", participants: [{ name: "Um", externalKey: "1" }] }; await importParticipants(a, data); expect((await importParticipants(a, data)).duplicated).toBe(1); await importParticipants(a, { ...data, source: "qr", participants: [{ name: "Dois", externalKey: "2" }] }); await expect(importParticipants(a, { ...data, participants: [{ name: "Três", externalKey: "3" }] })).rejects.toMatchObject({ status: 403 }); const [row] = await db.select().from(s.checkinRecords); const token = await participantQr(a, row.id); expect((await scanParticipant(a, { orderId: order.id, token })).checked).toBe(true); expect((await scanParticipant(a, { orderId: order.id, token })).duplicated).toBe(true); await expect(scanParticipant(b, { orderId: order.id, token })).rejects.toMatchObject({ status: 404 }); });
  it("área externa só mostra eventos selecionados e tarefas públicas", async () => { const { order, customer } = await event(); await saveRecord(a, "eventos", { title: "Planejamento", orderId: order.id, data: { tasks: [{ name: "Pública", dueDate: "2027-01-10", done: false, clientVisible: true }, { name: "Interna", dueDate: "2027-01-10", done: false, clientVisible: false }], responsibles: [customer.id] } }); const portal = await createPortal(a, { customerId: customer.id, orderIds: [order.id] }); const token = portal.path.split("/").pop()!; expect((await portalData(token)).tasks.map(t => t.name)).toEqual(["Pública"]); await expect(createPortal(b, { customerId: customer.id, orderIds: [order.id] })).rejects.toMatchObject({ status: 404 }); await revokePortal(a, { id: portal.id }); await expect(portalData(token)).rejects.toMatchObject({ status: 404 }); });
  it("treinamento registra somente a conclusão da pessoa atribuída", async () => { const t = await saveRecord(a, "treinamentos", { title: "Conferência", data: { content: "Contar as peças", assignees: [a.id] } }); await completeTraining(a, { id: t.record.id }); await completeTraining(a, { id: t.record.id }); const data = await productData(a, "treinamentos"); expect((data as { records: typeof s.productRecords.$inferSelect[] }).records[0].data.completedBy).toHaveLength(1); await expect(completeTraining(b, { id: t.record.id })).rejects.toMatchObject({ status: 403 }); });
  it("arquivo privado não permite travessia e dados não entram em backup de outra empresa", async () => { const filename = `${randomUUID()}.png`; await putPrivateFile(a.companyId, filename, Buffer.from("arquivo A"), "image/png"); expect((await getPrivateFile(a.companyId, filename)).toString()).toBe("arquivo A"); await expect(getPrivateFile(b.companyId, filename)).rejects.toMatchObject({ status: 404 }); await expect(getPrivateFile(a.companyId, "../segredo")).rejects.toMatchObject({ status: 400 }); await createCustomer(a, { name: "Somente A" }); await createCustomer(b, { name: "Somente B" }); const backup = await createBackup(a); const payload = decodeBackup((await downloadBackup(a, backup.id)).toString()); expect(payload.tables.customers.map(c => c.name)).toEqual(["Somente A"]); expect(payload.tables.platform_admins).toBeUndefined(); expect(payload.tables.saas_subscriptions).toHaveLength(1); });
  it("fluxo proposta → reserva → contrato → saída → devolução → financeiro preserva uma única reserva", async () => {
    const customer = (await createCustomer(a, { name: "Cliente completo", taxId: "00000000000", address: "Endereço de teste" })).customer;
    const [item] = await db.insert(s.catalogItems).values({ companyId: a.companyId, name: "Mesa", stockQty: 1, replacementCents: 10000 }).returning();
    await db.insert(s.companySettings).values({ companyId: a.companyId, preferences: { legalName: "Locadora A", taxId: "00000000000000", address: "Endereço de teste", contractTerms: "Cláusulas apenas para teste" } });
    const quote = (await createQuote(a, { customerId: customer.id, eventName: "Festa completa", eventDate: "2027-05-10", returnDueDate: "2027-05-11", lines: [{ catalogItemId: item.id, name: item.name, unit: "un", qty: 1, priceCents: 5000, periods: 1 }] })).document;
    const reservation = await reserveQuote(a, { id: quote.id }); expect((await reserveQuote(a, { id: quote.id })).duplicated).toBe(true);
    const contract = (await convertToContract(a, { id: quote.id, installments: [{ dueDate: "2027-05-10", amountCents: 5000 }] })).document;
    expect(contract.orderId).toBe(reservation.orderId); expect(await db.select().from(s.orders).where(eq(s.orders.companyId, a.companyId))).toHaveLength(1);
    const [line] = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, contract.orderId!));
    const response = await exitOrder(new NextRequest("http://localhost/api/exit", { method: "POST", body: JSON.stringify({ lines: [{ orderItemId: line.id, qtyDelivered: 1 }] }) }), { params: Promise.resolve({ id: contract.orderId! }) }); expect(response.status).toBe(200);
    await registerReturn({ orderId: contract.orderId!, lines: [{ orderItemId: line.id, qtyGood: 1, qtyDamaged: 0 }], idempotencyKey: randomUUID() }, a);
    await closeOrder({ orderId: contract.orderId!, confirmedMissingQty: 0 }, a);
    const [entry] = await db.select().from(s.financialEntries).where(eq(s.financialEntries.documentId, contract.id));
    await settleEntry(a, { entryId: entry.id, amountCents: 5000, method: "pix", idempotencyKey: randomUUID() });
    expect((await financeData(a, new URLSearchParams())).entries.find(e => e.id === entry.id)?.balanceCents).toBe(0);
  });
  it("liberação preserva histórico, libera estoque e permite reservar novamente", async () => {
    const customer = (await createCustomer(a, { name: "Cliente" })).customer; const [item] = await db.insert(s.catalogItems).values({ companyId: a.companyId, name: "Mesa", stockQty: 1, replacementCents: 1000 }).returning();
    const quote = (await createQuote(a, { customerId: customer.id, eventName: "Festa", eventDate: "2027-05-10", returnDueDate: "2027-05-11", lines: [{ catalogItemId: item.id, name: item.name, unit: "un", qty: 1, priceCents: 1000, periods: 1 }] })).document;
    const first = await reserveQuote(a, { id: quote.id }); await releaseQuote(a, { id: quote.id }); const next = await reserveQuote(a, { id: quote.id }); expect(next.orderId).not.toBe(first.orderId); expect((await db.select().from(s.orders).where(eq(s.orders.id, first.orderId!)))[0].status).toBe("cancelado");
  });
  it("métrica de proposta deduplica recargas e filtra prévias reconhecidas", async () => {
    const c = (await createCustomer(a, { name: "Cliente" })).customer; const quote = (await createQuote(a, { customerId: c.id, eventName: "Festa", eventDate: "2027-05-10", returnDueDate: "2027-05-11", lines: [{ catalogItemId: null, name: "Serviço", unit: "un", qty: 1, priceCents: 1000, periods: 1 }] })).document;
    const share = await shareDocument(a, { id: quote.id }); const token = share.path.split("/").pop()!;
    expect((await recordDocumentVisit(token, "visitor", "Mozilla/5.0", "")).recorded).toBe(true);
    expect((await recordDocumentVisit(token, "visitor", "Mozilla/5.0", "")).recorded).toBe(false);
    expect((await recordDocumentVisit(token, "preview", "WhatsApp/2.0", "")).recorded).toBe(false);
    expect(await db.select().from(s.documentVisits)).toHaveLength(1);
  });
  it("políticas RLS isolam consulta SQL de um papel sem bypass", async () => {
    await createCustomer(a, { name: "Somente A" }); await createCustomer(b, { name: "Somente B" });
    await client.exec("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='detali_test_reader') THEN CREATE ROLE detali_test_reader NOLOGIN; END IF; END $$; GRANT USAGE ON SCHEMA public, detali_private TO detali_test_reader; GRANT EXECUTE ON FUNCTION detali_private.detali_has_company(uuid) TO detali_test_reader; GRANT SELECT ON public.customers TO detali_test_reader;");
    await client.exec("BEGIN; SET LOCAL ROLE detali_test_reader;");
    try { await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: a.id })]); expect((await client.query<{ name: string }>("select name from public.customers")).rows.map(r => r.name)).toEqual(["Somente A"]); await client.query("select set_config('request.jwt.claims', '{}', true)"); expect((await client.query("select name from public.customers")).rows).toHaveLength(0); } finally { await client.exec("ROLLBACK"); }
  });
  it("adaptador Supabase grava e lê somente o caminho da empresa em bucket privado", async () => {
    process.env.STORAGE_PROVIDER = "supabase"; process.env.SUPABASE_URL = "https://storage-test.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-never-production";
    const calls: { url: string; method?: string }[] = []; const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => { calls.push({ url: String(url), method: options?.method }); return new Response(options?.method === "POST" ? "{}" : "arquivo", { status: 200 }); });
    try { await putPrivateFile(a.companyId, "photo.png", Buffer.from("arquivo"), "image/png"); expect((await getPrivateFile(a.companyId, "photo.png")).toString()).toBe("arquivo"); expect(calls[0].url).toContain(`/detali-files/${a.companyId}/photo.png`); expect(calls[1].url).toContain("/object/authenticated/"); } finally { mock.mockRestore(); process.env.STORAGE_PROVIDER = "local"; }
  });
});
