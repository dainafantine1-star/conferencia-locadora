import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID, createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { MockLanguageModelV4 } from "ai/test";
import { NextRequest } from "next/server";
const modelHolder = vi.hoisted(() => ({ model: undefined as unknown, user: undefined as unknown as import("@/lib/auth/session").SessionUser }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => Object.assign(() => modelHolder.model, { chat: () => modelHolder.model }) }));
vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite"); const { drizzle } = await import("drizzle-orm/pglite"); const schema = await import("@/lib/db/schema");
  const client = new PGlite(); return { db: drizzle(client, { schema }), client, isEmbedded: () => true };
});
vi.mock("@/lib/auth/session", () => ({ AuthError: class extends Error { constructor(message: string, public status = 401) { super(message); } }, requireSession: async () => ({ user: modelHolder.user }) }));
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { saveConfiguration, configurationData, aiConfig } from "@/lib/assistant/config";
import { saveAgent, saveRule, internalThread, inboxData, updateThread } from "@/lib/assistant/data";
import { saveKnowledge, retrieveKnowledge, extractKnowledge } from "@/lib/assistant/knowledge";
import { assistantChat, testAgent } from "@/lib/assistant/runtime";
import { proposeAction, executeAction, internalTools } from "@/lib/assistant/tools";
import { submitCommand, commandCapabilities, executeSystemCommand } from "@/lib/assistant/commands";
import { calendarData } from "@/lib/calendar/data";
import { ingestWebhook, receiveMessage, sendWhatsApp, validSignature, sendingHours } from "@/lib/assistant/channels";
import { runJobs } from "@/lib/assistant/worker";
import { POST as cron } from "@/app/api/cron/atendimento/route";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { POST as attendancePost } from "@/app/api/atendimento/[module]/route";
import { POST as assistantPost } from "@/app/api/assistente/route";
let client: PGlite; let company: string; let other: string; let user: SessionUser;
const baseAgent = { name: "Atendimento", instructions: "Responda somente fatos confirmados. Encaminhe quando não souber.", channel: "whatsapp", mode: "assistido", active: true, keywords: ["humano", "atendente"] };
beforeAll(async () => {
  client = (await import("@/lib/db") as unknown as { client: PGlite }).client;
  for (const file of readdirSync("drizzle").filter(f => f.endsWith(".sql")).sort()) await client.exec(readFileSync(`drizzle/${file}`, "utf8"));
}, 120000);
beforeEach(async () => {
  vi.unstubAllGlobals(); process.env.APP_ENCRYPTION_KEY = "assistant-isolated-test-key-at-least-32-characters";
  await client.exec("truncate companies, users cascade"); company = randomUUID(); other = randomUUID();
  await db.insert(s.companies).values([{ id: company, name: "Detali teste" }, { id: other, name: "Outra empresa" }]);
  const [u] = await db.insert(s.users).values({ email: "assistant@example.test", name: "Gestor teste", passwordHash: "not-a-real-password" }).returning();
  await db.insert(s.memberships).values({ companyId: company, userId: u.id, role: "gestor" });
  user = { id: u.id, email: u.email, name: u.name, role: "gestor", companyId: company, companyName: "Detali teste", timezone: "America/Bahia", permissions: [] };
  modelHolder.user = user;
});
afterAll(async () => { vi.unstubAllGlobals(); await client?.close(); });
const inbound = (id = randomUUID(), text = "Olá") => ({ id, from: "5571999999999", name: "Cliente", text, timestamp: new Date(), provider: "meta" as const });
async function metaConfigured() { await saveConfiguration(user, { preferences: { whatsappProvider: "meta", phoneId: "123456789", graphVersion: "v25.0", startHour: 0, endHour: 24 }, secrets: { metaToken: "test-only-token", metaAppSecret: "test-app-secret", verifyToken: "test-verify-token" } }); }
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } };
describe("assistente e atendimento com banco real isolado", () => {
  it("cadastra diretamente um cliente e repetições da mesma mensagem não duplicam", async () => {
    const thread = await internalThread(user), key = randomUUID();
    const a = await submitCommand(user, thread.id, key, "createCustomer", { name: "Cliente autônomo", phone: "5571999991111" });
    const b = await submitCommand(user, thread.id, key, "createCustomer", { phone: "5571999991111", name: "Cliente autônomo" });
    expect(a.status).toBe("executada"); expect(b.status).toBe("executada"); expect(await db.select().from(s.customers)).toHaveLength(1);
    expect(await db.select().from(s.auditLog).where(eq(s.auditLog.action, "comando_assistente_executado"))).toHaveLength(1);
  });
  it("um pedido em linguagem natural com tool call cadastra cliente de verdade", async () => {
    modelHolder.model = new MockLanguageModelV4({ doGenerate: [
      { content: [{ type: "tool-call", toolCallId: "create1", toolName: "createCustomer", input: JSON.stringify({ name: "Cliente criado pela IA", email: "cliente@example.test" }) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] },
      { content: [{ type: "text", text: "Cliente cadastrado no sistema." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
    ] });
    await saveConfiguration(user, { preferences: { provider: "openai", model: "modelo-de-teste" }, secrets: { aiKey: "test-key" } });
    const result = await assistantChat(user, { text: "Cadastre Cliente criado pela IA, email cliente@example.test", requestKey: randomUUID() });
    expect(result.actions[0].status).toBe("executada"); expect((await db.select().from(s.customers))[0].email).toBe("cliente@example.test");
  }, 120000);
  it("bloqueia exclusões, desativação, campos extras e comandos arbitrários", async () => {
    const thread = await internalThread(user);
    for (const name of ["deleteCustomer", "cancelDocument", "deleteHoliday", "restoreBackup", "__proto__"]) await expect(submitCommand(user, thread.id, randomUUID(), name, {})).rejects.toMatchObject({ status: 403 });
    await expect(submitCommand(user, thread.id, randomUUID(), "createCustomer", { name: "Teste", active: false })).rejects.toBeInstanceOf(Error);
    expect(commandCapabilities(user).some(c => c.name.toLowerCase().includes("delete"))).toBe(false);
  });
  it("comando rejeita conversa externa, outra empresa e permissão revogada", async () => {
    const [external] = await db.insert(s.aiThreads).values({ companyId: company, channel: "whatsapp", userId: user.id }).returning();
    await expect(submitCommand(user, external.id, randomUUID(), "createCustomer", { name: "Não criar" })).rejects.toMatchObject({ status: 404 });
    const thread = await internalThread(user);
    await expect(submitCommand({ ...user, companyId: other }, thread.id, randomUUID(), "createCustomer", { name: "Não criar" })).rejects.toMatchObject({ status: 403 });
    await db.update(s.memberships).set({ role: "operador", permissions: [] }).where(eq(s.memberships.userId, user.id));
    await expect(submitCommand(user, thread.id, randomUUID(), "createCustomer", { name: "Não criar" })).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(s.customers)).toHaveLength(0);
  });
  it("atualiza cliente sem apagar campos omitidos e respeita a empresa", async () => {
    const [customer] = await db.insert(s.customers).values({ companyId: company, name: "Antes", phone: "5571999990000", email: "antes@example.test" }).returning();
    const thread = await internalThread(user);
    const result = await submitCommand(user, thread.id, randomUUID(), "updateCustomer", { id: customer.id, name: "Depois" });
    expect(result.status).toBe("executada"); const [saved] = await db.select().from(s.customers); expect(saved.name).toBe("Depois"); expect(saved.phone).toBe(customer.phone); expect(saved.email).toBe(customer.email);
    const [foreign] = await db.insert(s.customers).values({ companyId: other, name: "Outra empresa" }).returning();
    const blocked = await submitCommand(user, thread.id, randomUUID(), "updateCustomer", { id: foreign.id, name: "Inválido" }); expect(blocked.status).toBe("verificar");
    expect((await db.select().from(s.customers).where(eq(s.customers.id, foreign.id)))[0].name).toBe("Outra empresa");
  });
  it("financeiro aguarda confirmação, revalida permissão e não duplica contas", async () => {
    const thread = await internalThread(user);
    const preview = await submitCommand(user, thread.id, randomUUID(), "createFinancialEntry", { direction: "pagar", description: "Fornecedor teste", amountCents: 12345, dueDate: "2027-06-01" });
    expect(preview.status).toBe("aguardando_confirmacao"); expect(await db.select().from(s.financialEntries)).toHaveLength(0);
    await db.update(s.memberships).set({ role: "operador", permissions: [] }).where(eq(s.memberships.userId, user.id));
    await expect(executeSystemCommand(user, preview.actionId, true)).rejects.toMatchObject({ status: 403 });
    await db.update(s.memberships).set({ role: "gestor" }).where(eq(s.memberships.userId, user.id));
    await executeAction(user, preview.actionId, true); await executeAction(user, preview.actionId, true);
    expect(await db.select().from(s.financialEntries)).toHaveLength(1);
  });
  it("prévia cancelada ou execução incerta não é repetida automaticamente", async () => {
    const thread = await internalThread(user);
    const preview = await submitCommand(user, thread.id, randomUUID(), "createFinancialEntry", { direction: "receber", description: "Teste", amountCents: 100, dueDate: "2027-01-01" });
    await executeSystemCommand(user, preview.actionId, false); await expect(executeSystemCommand(user, preview.actionId, true)).rejects.toMatchObject({ status: 409 });
    const key = randomUUID(); const failure = await submitCommand(user, thread.id, key, "updateCustomer", { id: randomUUID(), name: "Ausente" }); expect(failure.status).toBe("verificar");
    await expect(executeSystemCommand(user, failure.actionId, true)).rejects.toMatchObject({ status: 409 }); expect(await db.select().from(s.financialEntries)).toHaveLength(0);
  });
  it("cria produto e orçamento com preço real; sem período não inventa cobrança por hora", async () => {
    const thread = await internalThread(user);
    await submitCommand(user, thread.id, randomUUID(), "createProduct", { name: "Prato", unit: "un", replacementCents: 900, rentalPriceCents: 250, stockQty: 10 });
    const [product] = await db.select().from(s.catalogItems);
    const [customer] = await db.insert(s.customers).values({ companyId: company, name: "Cliente" }).returning();
    const input = { customerId: customer.id, eventName: "Festa", start: "2027-06-01", end: "2027-06-02", lines: [{ productId: product.id, qty: 3 }] };
    const result = await submitCommand(user, thread.id, randomUUID(), "createQuote", input); expect(result.status).toBe("executada");
    expect((await db.select().from(s.rentalDocuments))[0].totalCents).toBe(750);
    await db.update(s.catalogItems).set({ priceUnit: "hora" }).where(eq(s.catalogItems.id, product.id));
    const blocked = await submitCommand(user, thread.id, randomUUID(), "createQuote", input); expect(blocked.status).toBe("verificar"); expect(await db.select().from(s.rentalDocuments)).toHaveLength(1);
  });
  it("atualiza fornecedor sem apagar contatos omitidos e não altera outra empresa", async () => {
    const [supplier] = await db.insert(s.suppliers).values({ companyId: company, name: "Fornecedor", phone: "5571999995555", email: "fornecedor@example.test" }).returning();
    const thread = await internalThread(user);
    const result = await submitCommand(user, thread.id, randomUUID(), "saveSupplier", { id: supplier.id, name: "Fornecedor atualizado" });
    expect(result.status).toBe("executada"); const [saved] = await db.select().from(s.suppliers); expect(saved.name).toBe("Fornecedor atualizado"); expect(saved.phone).toBe(supplier.phone); expect(saved.email).toBe(supplier.email);
    const [foreign] = await db.insert(s.suppliers).values({ companyId: other, name: "Parceiro externo" }).returning();
    const blocked = await submitCommand(user, thread.id, randomUUID(), "saveSupplier", { id: foreign.id, name: "Inválido" }); expect(blocked.status).toBe("verificar");
  });
  it("reserva evento somente após confirmação e impede exceder estoque", async () => {
    const [customer] = await db.insert(s.customers).values({ companyId: company, name: "Cliente evento" }).returning();
    const [product] = await db.insert(s.catalogItems).values({ companyId: company, name: "Cadeira", stockQty: 3, replacementCents: 5000 }).returning();
    const thread = await internalThread(user);
    const input = { customerId: customer.id, eventName: "Evento via assistente", eventDate: "2027-09-10", returnDueDate: "2027-09-11", items: [{ productId: product.id, qty: 2 }] };
    const preview = await submitCommand(user, thread.id, randomUUID(), "createEvent", input); expect(await db.select().from(s.orders)).toHaveLength(0);
    const result = await executeAction(user, preview.actionId, true); expect(result).toHaveProperty("status", "executada");
    const next = await submitCommand(user, thread.id, randomUUID(), "createEvent", { ...input, eventName: "Sem estoque" });
    const blocked = await executeAction(user, next.actionId, true); expect(blocked).toHaveProperty("status", "verificar"); expect(await db.select().from(s.orders)).toHaveLength(1);
  });
  it("calendário inclui mais de 300 eventos, devoluções, datas locais e orçamentos sem duplicar contratados", async () => {
    const [customer] = await db.insert(s.customers).values({ companyId: company, name: "Cliente" }).returning();
    await db.insert(s.orders).values(Array.from({ length: 305 }, (_, i) => ({ companyId: company, customerId: customer.id, number: 1001 + i, eventName: `Evento ${i}`, eventDate: "2027-06-10", returnDueDate: "2027-06-11", createdBy: user.id })));
    await db.insert(s.orders).values({ companyId: company, customerId: customer.id, number: 2000, eventName: "Devolução do mês anterior", eventDate: "2027-05-30", returnDueDate: "2027-06-01", createdBy: user.id });
    await db.insert(s.holidays).values({ companyId: company, day: "2027-06-05", name: "Data local verificada", source: "manual" });
    await db.insert(s.rentalDocuments).values([{ companyId: company, customerId: customer.id, number: 1, kind: "orcamento", status: "rascunho", eventName: "Proposta", eventDate: "2027-06-12", returnDueDate: "2027-06-13", createdBy: user.id, lines: [], subtotalCents: 0, totalCents: 0 }, { companyId: company, customerId: customer.id, number: 2, kind: "orcamento", status: "contratado", eventName: "Já contratado", eventDate: "2027-06-12", returnDueDate: "2027-06-13", createdBy: user.id, lines: [], subtotalCents: 0, totalCents: 0 }]);
    const data = await calendarData(user, new URLSearchParams({ year: "2027", month: "6" })); expect(data.events).toHaveLength(307); expect(data.dates.some(d => d.name === "Data local verificada")).toBe(true); expect(data.dates.some(d => d.name === "São João")).toBe(true); expect(data.events.some(e => e.title === "Já contratado")).toBe(false);
    const operator = await calendarData({ ...user, role: "operador", permissions: [] }, new URLSearchParams({ year: "2027", month: "6" })); expect(operator.events.some(e => e.kind === "orcamento")).toBe(false);
    const isolated = await calendarData({ ...user, companyId: other }, new URLSearchParams({ year: "2027", month: "6" })); expect(isolated.events).toHaveLength(0); expect(isolated.dates.some(d => d.name === "Data local verificada")).toBe(false);
  });
  it("guia de QR Code funciona sem IA, persiste e não duplica ao repetir requestKey", async () => {
    const input = { text: "Onde imprimo QR Codes?", requestKey: randomUUID() };
    const first = await assistantChat(user, input); const again = await assistantChat(user, input);
    expect(first.messages.at(-1)?.metadata.engine).toBe("guia_local"); expect(first.messages.at(-1)?.content).toContain("Etiquetas para bipagem");
    expect(again.thread.id).toBe(first.thread.id); expect(again.messages).toHaveLength(2);
  });
  it("protege o histórico entre usuários e empresas", async () => {
    const thread = await internalThread(user);
    await expect(internalThread({ ...user, id: randomUUID() }, thread.id)).rejects.toMatchObject({ status: 404 });
    await expect(internalThread({ ...user, companyId: other }, thread.id)).rejects.toMatchObject({ status: 404 });
  });
  it("segredos ficam criptografados e atualizações parciais preservam configurações", async () => {
    await saveConfiguration(user, { preferences: { provider: "openai", model: "modelo-configuravel" }, secrets: { aiKey: "test-secret-not-plaintext" } });
    await saveConfiguration(user, { preferences: { dailyRuns: 8 } });
    const [stored] = await db.select().from(s.aiSettings); expect(stored.encryptedSecrets).not.toContain("test-secret-not-plaintext");
    const data = await configurationData(user); expect(JSON.stringify(data)).not.toContain("test-secret-not-plaintext"); expect(data.preferences.model).toBe("modelo-configuravel");
    expect((await aiConfig(company)).secrets.aiKey).toBe("test-secret-not-plaintext");
  });
  it("operador não pode configurar IA ou regras nem ler inbox sem permissão", async () => {
    const operator = { ...user, role: "operador" as const };
    await expect(saveConfiguration(operator, {})).rejects.toMatchObject({ status: 403 });
    await expect(saveRule(operator, {})).rejects.toMatchObject({ status: 403 });
    await expect(inboxData(operator)).rejects.toMatchObject({ status: 403 });
  });
  it("publica apenas um agente por canal e mantém histórico de versões", async () => {
    const { agent } = await saveAgent(user, baseAgent);
    await expect(saveAgent(user, { ...baseAgent, name: "Segundo" })).rejects.toMatchObject({ status: 409 });
    const changed = await saveAgent(user, { ...baseAgent, id: agent.id, active: false }); expect(changed.agent.version).toBe(2);
    const logs = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "agente_versionado")); expect(logs).toHaveLength(1);
  });
  it("busca conhecimento sem expor material interno ao cliente ou outra empresa", async () => {
    await saveKnowledge(user, { title: "Horários públicos", content: "A retirada dos produtos ocorre das oito às dezoito horas.", audience: "publico" });
    await saveKnowledge(user, { title: "Margem interna", content: "A retirada exige revisar a margem secreta da operação.", audience: "interno" });
    expect(await retrieveKnowledge(company, "retirada", true)).toHaveLength(1);
    expect(await retrieveKnowledge(company, "retirada", false)).toHaveLength(2);
    expect(await retrieveKnowledge(other, "retirada", false)).toHaveLength(0);
  });
  it("importa PDF com texto real para a base", async () => {
    const pdf = await PDFDocument.create(); const page = pdf.addPage(); page.drawText("Retirada de produtos somente no horario combinado", { font: await pdf.embedFont(StandardFonts.Helvetica) });
    const bytes = await pdf.save(); const text = await extractKnowledge(new File([new Uint8Array(bytes)], "manual.pdf", { type: "application/pdf" })); expect(text).toContain("Retirada de produtos");
  });
  it("comando cria cliente somente após confirmação, sem duplicidade", async () => {
    const thread = await internalThread(user); const proposal = await proposeAction(user, thread.id, "create_customer", { name: "Cliente confirmado", email: "", phone: "", taxId: "", address: "" }, "Novo cliente");
    expect(await db.select().from(s.customers)).toHaveLength(0);
    await executeAction(user, proposal.actionId, true); await executeAction(user, proposal.actionId, true);
    expect(await db.select().from(s.customers)).toHaveLength(1);
  });
  it("cancelar a prévia não altera cadastros", async () => {
    const thread = await internalThread(user); const p = await proposeAction(user, thread.id, "create_customer", { name: "Não cadastrar" }, "Cancelar");
    await executeAction(user, p.actionId, false); expect(await db.select().from(s.customers)).toHaveLength(0);
    await expect(executeAction(user, p.actionId, true)).rejects.toMatchObject({ status: 409 });
  });
  it("confirmação expirada ou permissão revogada bloqueia o comando", async () => {
    const thread = await internalThread(user); const p = await proposeAction(user, thread.id, "create_customer", { name: "Bloqueado" }, "Bloqueado");
    await db.update(s.aiActions).set({ expiresAt: new Date(0) }).where(eq(s.aiActions.id, p.actionId));
    await expect(executeAction(user, p.actionId, true)).rejects.toMatchObject({ status: 409 });
    await db.update(s.memberships).set({ role: "operador", permissions: [] }).where(eq(s.memberships.userId, user.id));
    await expect(executeAction(user, p.actionId, true)).rejects.toMatchObject({ status: 403 });
  });
  it("usa ToolLoopAgent com provedor controlado e registra consumo sem rede real", async () => {
    modelHolder.model = new MockLanguageModelV4({ doGenerate: { content: [{ type: "text", text: "Resposta controlada de teste" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] } });
    await saveConfiguration(user, { preferences: { provider: "openai", model: "modelo-de-teste", dailyRuns: 1 }, secrets: { aiKey: "test-key" } });
    const first = await assistantChat(user, { text: "Olá", requestKey: randomUUID() }); expect(first.messages.at(-1)?.content).toBe("Resposta controlada de teste");
    const [run] = await db.select().from(s.aiRuns); expect(run.inputTokens).toBe(10); expect(run.outputTokens).toBe(5); expect(run.status).toBe("concluida");
    const blocked = await assistantChat(user, { threadId: first.thread.id, text: "Outra pergunta", requestKey: randomUUID() }); expect(blocked.messages.at(-1)?.content).toContain("Limite diário");
  }, 120000);
  it("um agente com tool call prepara a ação e não executa o cadastro sozinho", async () => {
    modelHolder.model = new MockLanguageModelV4({ doGenerate: [
      { content: [{ type: "tool-call", toolCallId: "call1", toolName: "prepareCustomer", input: JSON.stringify({ name: "Cliente via agente", email: "", phone: "", taxId: "", address: "" }) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] },
      { content: [{ type: "text", text: "Confira a prévia antes de confirmar." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
    ] });
    await saveConfiguration(user, { preferences: { provider: "openai", model: "modelo-de-teste" }, secrets: { aiKey: "test-key" } });
    const result = await assistantChat(user, { text: "Cadastre o cliente", requestKey: randomUUID() });
    expect(result.actions).toHaveLength(1); expect(result.actions[0].status).toBe("pendente"); expect(await db.select().from(s.customers)).toHaveLength(0);
  });
  it("webhook exige assinatura e não processa número diferente", async () => {
    await metaConfigured(); const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "123456789" }, messages: [{ id: "msg1", from: "5571999999999", timestamp: String(Math.floor(Date.now()/1000)), type: "text", text: { body: "Olá" } }] } }] }] });
    await expect(ingestWebhook(company, raw, new Headers())).rejects.toMatchObject({ status: 401 });
    const signature = `sha256=${createHmac("sha256", "test-app-secret").update(raw).digest("hex")}`;
    await ingestWebhook(company, raw, new Headers({ "x-hub-signature-256": signature })); await ingestWebhook(company, raw, new Headers({ "x-hub-signature-256": signature }));
    expect(await db.select().from(s.aiMessages)).toHaveLength(1);
    expect(validSignature(raw + " ", signature, "test-app-secret", "sha256")).toBe(false);
  });
  it("mensagens repetidas não criam filas duplicadas", async () => {
    await saveAgent(user, baseAgent); const m = inbound(); await receiveMessage(company, m); await receiveMessage(company, m);
    expect(await db.select().from(s.aiJobs)).toHaveLength(1); expect(await db.select().from(s.aiThreads)).toHaveLength(1);
  });
  it("pedido de humano suspende IA; mídia encaminha para revisão sem inventar transcrição", async () => {
    await saveAgent(user, baseAgent); await receiveMessage(company, inbound(randomUUID(), "Quero falar com humano"));
    expect((await db.select().from(s.aiThreads))[0].status).toBe("humano"); expect(await db.select().from(s.aiJobs)).toHaveLength(0);
    await receiveMessage(company, { ...inbound(), from: "5571888888888", text: "", media: "audio" });
    expect((await db.select().from(s.aiMessages)).some(m => m.content.includes("revisão humana"))).toBe(true);
  });
  it("opt-out impede envio e mensagem antiga não reabre janela", async () => {
    await metaConfigured(); await receiveMessage(company, inbound(randomUUID(), "PARAR")); const [t] = await db.select().from(s.aiThreads);
    await expect(sendWhatsApp(user, { threadId: t.id, text: "Não enviar", requestKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
    await receiveMessage(company, { ...inbound(), timestamp: new Date(Date.now() - 4 * 86400000) });
    const [again] = await db.select().from(s.aiThreads); expect(again.optedOut).toBe(true); expect(again.lastInboundAt?.getTime()).toBe(t.lastInboundAt?.getTime());
  });
  it("envio registra aceite e não repete requestKey", async () => {
    await metaConfigured(); const { threadId } = await receiveMessage(company, inbound()); const fetcher = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "wamid-test" }] })); vi.stubGlobal("fetch", fetcher);
    const p = { threadId, text: "Resposta de teste", requestKey: randomUUID() }; await sendWhatsApp(user, p); const second = await sendWhatsApp(user, p);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(second.message.status).toBe("aceita");
  });
  it("timeout vira incerto e nunca autoriza reenvio cego", async () => {
    await metaConfigured(); const { threadId } = await receiveMessage(company, inbound()); const fetcher = vi.fn().mockRejectedValue(new Error("timeout")); vi.stubGlobal("fetch", fetcher);
    const p = { threadId, text: "Resposta", requestKey: randomUUID() }; await expect(sendWhatsApp(user, p)).rejects.toMatchObject({ status: 502 });
    const second = await sendWhatsApp(user, p); expect(second.message.status).toBe("incerto"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("fora de 24h bloqueia resposta livre antes de chamar o provedor", async () => {
    await metaConfigured(); const { threadId } = await receiveMessage(company, { ...inbound(), timestamp: new Date(Date.now() - 25 * 3600000) }); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(sendWhatsApp(user, { threadId, text: "Não enviar", requestKey: randomUUID() })).rejects.toMatchObject({ status: 409 }); expect(fetcher).not.toHaveBeenCalled();
  });
  it("regra em modo rascunho processa de verdade e não chama WhatsApp", async () => {
    await saveRule(user, { name: "Boas-vindas", trigger: "nova_conversa", delayMinutes: 0, action: "rascunho", text: "Olá! Como podemos ajudar?", active: true });
    await receiveMessage(company, inbound()); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); const result = await runJobs(company);
    expect(result.results[0].status).toBe("rascunho"); expect(fetcher).not.toHaveBeenCalled();
    expect((await db.select().from(s.aiMessages)).some(m => m.status === "rascunho")).toBe(true);
  });
  it("assumir atendimento cancela jobs ainda na fila", async () => {
    await saveAgent(user, baseAgent); const { threadId } = await receiveMessage(company, inbound());
    await updateThread(user, { id: threadId, status: "humano", assignedTo: user.id });
    const result = await runJobs(company); expect(result.results[0].status).toBe("cancelada");
  });
  it("agendador sem segredo é rejeitado e horário usa o fuso da locadora", async () => {
    const response = await cron(new NextRequest("http://localhost/api/cron/atendimento", { method: "POST" })); expect(response.status).toBe(401);
    expect(sendingHours({ startHour: 8, endHour: 20 }, "America/Bahia", new Date("2026-11-14T10:00:00Z"))).toBe(false);
    expect(sendingHours({ startHour: 8, endHour: 20 }, "America/Bahia", new Date("2026-11-14T11:00:00Z"))).toBe(true);
  });
  it("RLS impede leitura direta por papel sem privilégio, mantendo acesso do servidor", async () => {
    await receiveMessage(company, inbound());
    await client.exec("do $$ begin if not exists(select 1 from pg_roles where rolname='assistant_anon_test') then create role assistant_anon_test nologin; end if; end $$; grant usage on schema public to assistant_anon_test; grant select on ai_messages to assistant_anon_test;");
    try {
      await client.exec("set role assistant_anon_test");
      const result = await client.query<{ n: number }>("select count(*)::int as n from ai_messages"); expect(result.rows[0].n).toBe(0);
    } finally { await client.exec("reset role"); }
    expect(await db.select().from(s.aiMessages)).toHaveLength(1);
  });
  it("prévia de orçamento usa preço real e a confirmação cria o orçamento uma vez", async () => {
    const [customer] = await db.insert(s.customers).values({ companyId: company, name: "Cliente orçamento" }).returning();
    const [product] = await db.insert(s.catalogItems).values({ companyId: company, name: "Taça", replacementCents: 500, stockQty: 10, rentalPriceCents: 275 }).returning();
    const thread = await internalThread(user); const tools = internalTools(user, thread.id);
    const proposal = await tools.prepareQuote.execute!({ customerId: customer.id, eventName: "Evento teste", start: "2027-04-10", end: "2027-04-11", lines: [{ productId: product.id, qty: 3 }] }, { toolCallId: "test", messages: [], context: {} }) as { actionId: string };
    expect(await db.select().from(s.rentalDocuments)).toHaveLength(0);
    await executeAction(user, proposal.actionId, true); await executeAction(user, proposal.actionId, true);
    const docs = await db.select().from(s.rentalDocuments); expect(docs).toHaveLength(1); expect(docs[0].totalCents).toBe(825);
  });
  it("produto por hora não recebe período inventado pelo assistente", async () => {
    const [customer] = await db.insert(s.customers).values({ companyId: company, name: "Cliente" }).returning();
    const [product] = await db.insert(s.catalogItems).values({ companyId: company, name: "Equipamento", replacementCents: 500, rentalPriceCents: 200, priceUnit: "hora" }).returning();
    const tools = internalTools(user, (await internalThread(user)).id);
    await expect(tools.prepareQuote.execute!({ customerId: customer.id, eventName: "Evento", start: "2027-04-10", end: "2027-04-11", lines: [{ productId: product.id, qty: 1 }] }, { toolCallId: "test", messages: [], context: {} })).rejects.toThrow("confirme");
  });
  it("webhook WAHA rejeita eventos sem autenticação e aceita cabeçalho secreto configurado", async () => {
    process.env.WAHA_ALLOWED_HOSTS = "localhost";
    await saveConfiguration(user, { preferences: { whatsappProvider: "waha", wahaUrl: "http://localhost:3002/", wahaSession: "detali-test" }, secrets: { wahaKey: "test-key", wahaWebhookSecret: "test-webhook-secret-at-least-32-characters" } });
    const raw = JSON.stringify({ event: "message.any", session: "detali-test", payload: { id: "waha1", from: "5571999999999@c.us", body: "Olá", timestamp: Math.floor(Date.now()/1000), fromMe: false } });
    await expect(ingestWebhook(company, raw, new Headers())).rejects.toMatchObject({ status: 401 });
    await ingestWebhook(company, raw, new Headers({ "x-detali-webhook-token": "test-webhook-secret-at-least-32-characters" }));
    expect(await db.select().from(s.aiThreads)).toHaveLength(1);
  });
  it("nova mensagem cancela acompanhamento antigo", async () => {
    const { rule } = await saveRule(user, { name: "Acompanhar", trigger: "sem_resposta", delayMinutes: 5, action: "rascunho", text: "Precisa de ajuda?", active: true });
    await receiveMessage(company, inbound()); const [first] = await db.select().from(s.aiJobs);
    await receiveMessage(company, { ...inbound(), timestamp: new Date(Date.now() + 10) });
    await db.update(s.aiJobs).set({ dueAt: new Date(0) }).where(eq(s.aiJobs.id, first.id));
    const result = await runJobs(company); expect(result.results[0].status).toBe("cancelada");
  });
  it("regra automática envia pela API controlada e registra apenas um aceite", async () => {
    await metaConfigured();
    await saveRule(user, { name: "Boas-vindas", trigger: "nova_conversa", delayMinutes: 0, action: "enviar", text: "Olá! Sou o assistente virtual da locadora.", active: true });
    await receiveMessage(company, inbound()); const fetcher = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "auto-test" }] })); vi.stubGlobal("fetch", fetcher);
    const result = await runJobs(company); expect(result.results[0].status).toBe("concluida"); await runJobs(company); expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await db.select().from(s.aiMessages)).filter(m => m.status === "aceita")).toHaveLength(1);
  });
  it("status de entrega e leitura vêm do webhook e não regridem com evento atrasado", async () => {
    await metaConfigured(); const { threadId } = await receiveMessage(company, inbound());
    await db.insert(s.aiMessages).values({ companyId: company, threadId: threadId!, role: "assistant", content: "Teste", externalId: "meta:status-test", status: "aceita" });
    for (const status of ["delivered", "read", "sent"]) {
      const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "123456789" }, statuses: [{ id: "status-test", status }] } }] }] });
      await ingestWebhook(company, raw, new Headers({ "x-hub-signature-256": `sha256=${createHmac("sha256", "test-app-secret").update(raw).digest("hex")}` }));
    }
    const [message] = await db.select().from(s.aiMessages).where(eq(s.aiMessages.externalId, "meta:status-test")); expect(message.status).toBe("lida");
  });
  it("confirmação recebida antes da resposta de envio é preservada", async () => {
    await metaConfigured(); const { threadId } = await receiveMessage(company, inbound());
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "123456789" }, statuses: [{ id: "early-status", status: "delivered" }] } }] }] });
    await ingestWebhook(company, raw, new Headers({ "x-hub-signature-256": `sha256=${createHmac("sha256", "test-app-secret").update(raw).digest("hex")}` }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "early-status" }] })));
    const result = await sendWhatsApp(user, { threadId, text: "Teste", requestKey: randomUUID() }); expect(result.message.status).toBe("entregue");
  });
  it("rota de automações preserva o campo action da regra ao persistir", async () => {
    const response = await attendancePost(new NextRequest("http://localhost/api/atendimento/automacoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Regra pela API", trigger: "nova_conversa", action: "rascunho", text: "Olá, cliente", delayMinutes: 0, active: true }) }), { params: Promise.resolve({ module: "automacoes" }) });
    expect(response.status).toBe(200); expect((await response.json()).rule.action).toBe("rascunho"); expect(await db.select().from(s.aiRules)).toHaveLength(1);
  });
  it("rota do assistente liga mensagem HTTP ao histórico e à ajuda real", async () => {
    const response = await assistantPost(new NextRequest("http://localhost/api/assistente", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "QR", requestKey: randomUUID() }) }));
    expect(response.status).toBe(200); const data = await response.json(); expect(data.messages.at(-1).metadata.links[0].href).toBe("/catalogo"); expect(await db.select().from(s.aiMessages)).toHaveLength(2);
  });
  it("API rejeita origem externa antes de cadastrar regra", async () => {
    const response = await attendancePost(new NextRequest("http://localhost/api/atendimento/automacoes", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://attacker.example" }, body: "{}" }), { params: Promise.resolve({ module: "automacoes" }) });
    expect(response.status).toBe(403); expect(await db.select().from(s.aiRules)).toHaveLength(0);
  });
});
