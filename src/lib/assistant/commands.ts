import { createHash } from "node:crypto";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiActions, aiThreads, catalogItems, suppliers } from "@/lib/db/schema";
import { AuthError, type SessionUser } from "@/lib/auth/session";
import { uuid, day, cents, positiveCents, audit, fail, lockCompany } from "@/lib/erp/common";
import { customerFields, customerUpdateSchema, createCustomer, updateCustomer } from "@/lib/erp/customer";
import { productSchema, createProduct, updateProduct } from "@/lib/erp/catalog";
import { createQuote, convertToContract, shareDocument, reviseQuote, quoteSchema } from "@/lib/erp/commercial";
import { createFinancialEntry, settleEntry, payCommission, importConference } from "@/lib/erp/finance";
import { saveSupplier } from "@/lib/erp/contacts";
import { moveStock } from "@/lib/erp/inventory";
import { createLogisticsTask, updateLogisticsTask } from "@/lib/erp/logistics";
import { saveHoliday } from "@/lib/erp/holidays";
import { savePage, updateLead, quoteFromLead } from "@/lib/erp/store";
import { createBackup } from "@/lib/erp/backup";
import { createCheckout, requestSignature, syncSignature } from "@/lib/erp/integrations";
import { saveAgent, saveRule, updateThread } from "./data";
import { saveKnowledge } from "./knowledge";
import { sendWhatsApp } from "./channels";
import { createRentalOrder } from "@/lib/erp/orders";
import { registerReturn } from "@/lib/business/returns";
import { closeOrder } from "@/lib/business/closures";
import { freshUser } from "./access";
import { allowed, assertAllowed } from "./config";

type Command = { title: string; description: string; permission: string; confirmation: boolean; schema: z.ZodType; run: (user: SessionUser, input: unknown, key: string) => Promise<unknown> };
function command<S extends z.ZodType>(title: string, description: string, permission: string, schema: S, run: (user: SessionUser, input: z.output<S>, key: string) => Promise<unknown>, confirmation = false): Command {
  return { title, description, permission, schema, confirmation, run: (user, input, key) => run(user, schema.parse(input), key) };
}
const contact = customerFields.strict();
const method = z.enum(["pix", "dinheiro", "cartao", "boleto", "transferencia", "outro"]);
const quoteInput = z.object({ customerId: uuid, eventName: z.string().trim().min(1).max(300), start: day, end: day, deliveryAddress: z.string().max(2000).default(""), deliveryCents: cents.default(0), discountCents: cents.default(0), notes: z.string().max(5000).default(""), lines: z.array(z.object({ productId: uuid, qty: z.number().int().min(1).max(100000), periods: z.number().int().min(1).max(3660).optional() }).strict()).min(1).max(100) }).strict();

// A closed allowlist, shared by the SDK tools and the confirmation endpoint.
// No arbitrary route, SQL, code, secret, password, deletion, cancellation or
// deactivation can be supplied through a tool argument.
export const commands: Record<string, Command> = {
  createCustomer: command("Cadastrar cliente", "Cadastra de fato um cliente quando o usuário pedir e informar os dados. Consulte clientes para evitar duplicidade. Peça dados ausentes; não invente contatos.", "clientes", contact, createCustomer),
  updateCustomer: command("Atualizar cliente", "Atualiza somente os campos informados de um cliente real. Não desativa nem apaga.", "clientes", customerUpdateSchema.omit({ active: true }).strict(), updateCustomer),
  createProduct: command("Cadastrar produto", "Cadastra produto real com unidade e valor de reposição explicitamente informados, em centavos. Não invente preço ou estoque.", "estoque", productSchema.omit({ active: true }).strict(), createProduct),
  updateProduct: command("Atualizar produto", "Atualiza nome, preços e apresentação do produto real. Alterações de estoque usam moveStock. Publicar na loja exige pedido explícito.", "estoque", productSchema.omit({ active: true, stockQty: true }).partial().extend({ id: uuid }).strict(), updateProduct),
  saveSupplier: command("Salvar fornecedor", "Cadastra ou atualiza fornecedor. Somente campos explicitamente informados são alterados; os demais são preservados.", "clientes", customerUpdateSchema.omit({ active: true, id: true }).extend({ id: uuid.optional() }).strict().refine(d => !!d.id || !!d.name, "Informe o nome do novo fornecedor"), async (u, d) => {
    if (!d.id) return saveSupplier(u, d);
    const [current] = await db.select().from(suppliers).where(and(eq(suppliers.id, d.id), eq(suppliers.companyId, u.companyId)));
    if (!current) fail("Fornecedor não encontrado", 404);
    return saveSupplier(u, { name: current.name, email: current.email, phone: current.phone, taxId: current.taxId, address: current.address, notes: current.notes, active: current.active, ...d });
  }),
  createQuote: command("Criar orçamento", "Cria orçamento real com os preços do catálogo. Consulte produtos e cliente antes. Cobrança por hora/diária exige períodos informados; não assume duração. Não reserva produtos.", "comercial", quoteInput, async (user, data) => {
    const products = await db.select().from(catalogItems).where(and(eq(catalogItems.companyId, user.companyId), eq(catalogItems.active, true), inArray(catalogItems.id, data.lines.map(l => l.productId))));
    return createQuote(user, { customerId: data.customerId, eventName: data.eventName, eventDate: data.start, returnDueDate: data.end, deliveryAddress: data.deliveryAddress, deliveryCents: data.deliveryCents, discountCents: data.discountCents, notes: data.notes, lines: data.lines.map(line => {
      const p = products.find(p => p.id === line.productId);
      if (!p || p.rentalPriceCents === null) fail("Produto sem preço cadastrado ou indisponível para esta empresa");
      if (p.priceUnit !== "evento" && line.periods === undefined) fail("Confirme a quantidade de períodos cobrados por hora/diária antes de criar o orçamento");
      return { catalogItemId: p.id, name: p.name, unit: p.unit, qty: line.qty, periods: line.periods ?? 1, priceCents: p.rentalPriceCents };
    }) });
  }),
  createEvent: command("Criar evento / pedido", "Prepara pedido operacional que reserva estoque. Exige cliente, evento, datas e quantidades explicitamente solicitadas; consulte produtos reais. Não substitui orçamento ou contrato.", "comercial", z.object({ customerId: uuid, eventName: z.string().min(1).max(300), eventDate: day, returnDueDate: day, notes: z.string().max(5000).default(""), items: z.array(z.object({ productId: uuid, qty: z.number().int().min(1).max(100000) }).strict()).min(1).max(100) }).strict(), async (u, d) => {
    const products = await db.select().from(catalogItems).where(and(eq(catalogItems.companyId, u.companyId), eq(catalogItems.active, true), inArray(catalogItems.id, d.items.map(i => i.productId))));
    return createRentalOrder(u, { ...d, items: d.items.map(i => { const p = products.find(p => p.id === i.productId); if (!p || p.stockQty === null) fail("Cadastre o produto e seu inventário antes de reservar pelo assistente"); return { catalogItemId: p.id, name: p.name, unit: p.unit, qtyPlanned: i.qty }; }) });
  }, true),
  registerReturn: command("Registrar devolução", "Prepara devolução com contagens físicas informadas pelo usuário, em bom estado e avariadas por item. Consulte pedido e IDs reais dos itens. Não invente conferência.", "logistica", z.object({ orderId: uuid, lines: z.array(z.object({ orderItemId: uuid, qtyGood: z.number().int().min(0).max(100000), qtyDamaged: z.number().int().min(0).max(100000) }).strict()).min(1).max(200), notes: z.string().max(5000).default("") }).strict(), (u, d, key) => registerReturn({ ...d, idempotencyKey: key }, u), true),
  closeEvent: command("Fechar conferência de evento", "Prepara fechamento de conferência. Exige quantidade faltante explicitamente conferida pelo gestor; pode gerar cobrança e alterar estoque de faltas. Nunca adivinhe faltas.", "gestor", z.object({ orderId: uuid, confirmedMissingQty: z.number().int().min(0).max(1000000) }).strict(), (u, d) => closeOrder(d, u), true),
  reviseQuote: command("Revisar orçamento", "Prepara revisão completa do orçamento com itens, preços e condições explicitamente solicitados. Consulte o documento atual para preservar os outros campos.", "comercial", quoteSchema.safeExtend({ id: uuid }), reviseQuote, true),
  convertToContract: command("Emitir contrato", "Prepara emissão real de contrato com reserva de estoque e parcelas. Exige orçamento real e parcelas combinadas; não invente cláusulas ou comissão.", "comercial", z.object({ id: uuid, installments: z.array(z.object({ dueDate: day, amountCents: cents }).strict()).min(1).max(120), commissionBps: z.number().int().min(0).max(10000).optional(), commissionBasis: z.enum(["recebimento", "contrato"]).optional(), terms: z.string().max(30000).optional() }).strict(), convertToContract, true),
  shareDocument: command("Gerar link de documento", "Gera link real para o documento quando solicitado, com validade definida pelo sistema. Não envia a terceiros.", "comercial", z.object({ id: uuid }).strict(), shareDocument),
  createFinancialEntry: command("Criar conta", "Prepara conta a pagar ou receber com descrição, valor e vencimento explícitos. Não é pagamento.", "financeiro", z.object({ direction: z.enum(["pagar", "receber"]), description: z.string().min(1).max(300), category: z.string().min(1).max(80).default("geral"), customerId: uuid.optional(), supplierId: uuid.optional(), amountCents: positiveCents, dueDate: day }).strict(), createFinancialEntry, true),
  settleEntry: command("Registrar pagamento ou recebimento", "Prepara baixa de pagamento já comprovado pelo usuário. Não movimenta dinheiro em banco. Exige valor e meio de pagamento informados.", "financeiro", z.object({ entryId: uuid, amountCents: positiveCents, method, occurredAt: z.iso.datetime().optional(), note: z.string().max(2000).default("") }).strict(), (u, d, key) => settleEntry(u, { ...d, idempotencyKey: key }), true),
  payCommission: command("Registrar comissão paga", "Registra comissão realmente paga, somente por solicitação explícita e comprovada. Não transfere dinheiro.", "financeiro", z.object({ id: uuid, method }).strict(), (u, d, key) => payCommission(u, { ...d, idempotencyKey: key }), true),
  importConference: command("Vincular cobrança da conferência", "Vincula cobrança histórica comprovada ao financeiro. Exige vencimento, valor já recebido e meio informado; data do recebimento se houver.", "financeiro", z.object({ orderId: uuid, dueDate: day, receivedCents: cents, occurredAt: z.iso.datetime().optional(), method }).strict(), (u, d) => importConference(u, { ...d, confirmed: true }), true),
  moveStock: command("Movimentar estoque", "Prepara entrada, saída, manutenção, reparo ou inventário real, com quantidade e motivo explícitos. Não apaga produto.", "estoque", z.object({ catalogItemId: uuid, kind: z.enum(["entrada", "saida", "manutencao", "reparo", "inventario"]), quantity: z.number().int().min(0).max(1000000), reason: z.string().min(3).max(2000) }).strict(), moveStock, true),
  scheduleLogistics: command("Agendar entrega ou coleta", "Agenda logística de um pedido real. Exige data/hora e endereço; não confirma saída ou devolução física.", "logistica", z.object({ orderId: uuid, kind: z.enum(["entrega", "coleta"]), scheduledAt: z.iso.datetime(), address: z.string().min(5).max(2000), contact: z.string().max(200).default(""), assigneeId: uuid.optional(), vehicle: z.string().max(100).default(""), notes: z.string().max(3000).default("") }).strict(), createLogisticsTask),
  updateLogistics: command("Atualizar entrega ou coleta", "Marca logística em rota ou concluída, respeitando conferências reais de saída e devolução. Não cancela tarefas.", "logistica", z.object({ id: uuid, status: z.enum(["em_rota", "concluida"]), notes: z.string().max(3000).optional() }).strict(), updateLogisticsTask, true),
  addCalendarDate: command("Adicionar data ao calendário", "Adiciona data local com nome e dia explicitamente solicitados. Não bloqueia estoque.", "gestor", z.object({ day, name: z.string().min(2).max(200) }).strict(), saveHoliday),
  saveStorePage: command("Salvar página da loja", "Cria ou atualiza página da loja com texto solicitado. Publicação requer confirmação.", "gestor", z.object({ id: uuid.optional(), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80), title: z.string().min(1).max(200), content: z.string().max(50000), published: z.boolean() }).strict(), savePage, true),
  updateStoreLead: command("Atualizar solicitação da loja", "Marca solicitação em atendimento ou concluída. Não arquiva nem apaga.", "gestor", z.object({ id: uuid, status: z.enum(["em_atendimento", "concluido"]) }).strict(), updateLead),
  quoteFromStoreLead: command("Orçar solicitação da loja", "Gera orçamento real de uma solicitação existente, com preços cadastrados. Não contrata ou envia.", "gestor", z.object({ id: uuid }).strict(), quoteFromLead),
  createBackup: command("Criar backup", "Gera backup criptografado real dos dados e arquivos. Não restaura nem sobrescreve banco.", "gestor", z.object({}).strict(), u => createBackup(u), true),
  createCheckout: command("Gerar cobrança PagBank", "Prepara link de cobrança real no PagBank para uma conta. Depende de integração configurada; não confirma pagamento.", "financeiro", z.object({ entryId: uuid }).strict(), (u, d, key) => createCheckout(u, { ...d, requestKey: key }), true),
  requestSignature: command("Solicitar assinatura", "Prepara envio de contrato ao provedor de assinatura configurado. Não assina pelo cliente.", "comercial", z.object({ id: uuid }).strict(), requestSignature, true),
  syncSignature: command("Consultar assinatura", "Consulta no provedor o estado real de assinatura de contrato.", "comercial", z.object({ id: uuid }).strict(), syncSignature),
  saveKnowledge: command("Salvar conhecimento", "Cadastra texto de referência do atendimento. Publicar texto para clientes exige confirmação; não apaga materiais.", "gestor", z.object({ id: uuid.optional(), title: z.string().min(3).max(200), content: z.string().min(10).max(100000), audience: z.enum(["interno", "publico"]) }).strict(), (u, d) => saveKnowledge(u, { ...d, active: true }), true),
  saveAgent: command("Salvar agente", "Prepara configuração de agente. Consulte agentes existentes para preservar instruções e canal. Modo automático pode enviar mensagens reais.", "gestor", z.object({ id: uuid.optional(), name: z.string().min(2).max(100), instructions: z.string().max(16000), channel: z.enum(["interno", "whatsapp"]), mode: z.enum(["assistido", "automatico"]), active: z.boolean(), keywords: z.array(z.string().min(2).max(60)).max(30) }).strict(), saveAgent, true),
  saveAutomation: command("Salvar automação WhatsApp", "Prepara regra de WhatsApp comercial. Consulte automações existentes. Envio depende de conexão e agendador reais.", "gestor", z.object({ id: uuid.optional(), name: z.string().min(2).max(120), active: z.boolean(), trigger: z.enum(["nova_conversa", "mensagem_recebida", "sem_resposta"]), keyword: z.string().max(120).default(""), delayMinutes: z.number().int().min(0).max(10080), action: z.enum(["rascunho", "enviar", "humano"]), text: z.string().max(3000).default("") }).strict(), saveRule, true),
  updateConversation: command("Atualizar atendimento", "Atribui conversa, transfere para humano ou marca resolução. Não envia mensagem nem apaga histórico.", "atendimento", z.object({ id: uuid, status: z.enum(["aberto", "humano", "resolvido"]), assignedTo: uuid.nullable().optional() }).strict(), updateThread),
  sendWhatsApp: command("Enviar mensagem WhatsApp", "Prepara mensagem para uma conversa real do CRM. Exige destinatário e texto explícitos; respeita opt-out, janela do provedor e limites. Não envia antes da confirmação.", "atendimento", z.object({ threadId: uuid, text: z.string().trim().min(1).max(3000) }).strict(), (u, d, key) => sendWhatsApp(u, { ...d, requestKey: key }), true),
};
export function commandCapabilities(user: SessionUser) {
  return Object.entries(commands).filter(([, c]) => allowed(user, c.permission)).map(([name, c]) => ({ name, title: c.title, confirmation: c.confirmation }));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
function commandId(company: string, user: string, thread: string, request: string, name: string, input: unknown) {
  const hash = createHash("sha256").update(canonical([company, user, thread, request, name, input])).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
async function ownedThread(user: SessionUser, id: string) {
  const [thread] = await db.select({ id: aiThreads.id }).from(aiThreads).where(and(eq(aiThreads.id, id), eq(aiThreads.companyId, user.companyId), eq(aiThreads.userId, user.id), eq(aiThreads.channel, "interno")));
  if (!thread) fail("Conversa interna não encontrada", 404);
}
export async function submitCommand(initial: SessionUser, threadId: string, request: string, name: string, input: unknown) {
  const user = await freshUser(initial); await ownedThread(user, threadId);
  if (!Object.hasOwn(commands, name)) fail("Comando indisponível. Exclusões e cancelamentos são bloqueados.", 403);
  const command = commands[name]; assertAllowed(user, command.permission);
  const parsed = command.schema.parse(input), id = commandId(user.companyId, user.id, threadId, request, name, parsed);
  await db.insert(aiActions).values({ id, companyId: user.companyId, userId: user.id, threadId, kind: "system_command", title: command.title, payload: { command: name, input: parsed }, expiresAt: new Date(Date.now() + 15 * 60000) }).onConflictDoNothing();
  if (!command.confirmation) return executeSystemCommand(user, id, true);
  return { actionId: id, title: command.title, status: "aguardando_confirmacao", preview: parsed, warning: "Operação preparada; confirme no cartão da conversa. Ainda não foi executada." };
}
export async function executeSystemCommand(initial: SessionUser, id: string, confirm: boolean) {
  uuid.parse(id); const user = await freshUser(initial);
  const claimed = await db.transaction(async tx => {
    await lockCompany(tx, user.companyId);
    const [action] = await tx.select().from(aiActions).where(and(eq(aiActions.id, id), eq(aiActions.companyId, user.companyId), eq(aiActions.userId, user.id), eq(aiActions.kind, "system_command"))).for("update");
    if (!action) fail("Comando não encontrado", 404);
    const name = z.string().parse(action.payload.command);
    if (!Object.hasOwn(commands, name)) fail("Comando bloqueado", 403);
    assertAllowed(user, commands[name].permission);
    if (action.status === "executada") return { action, done: true };
    if (action.status !== "pendente") fail("Comando já encerrado ou em execução. Confira o histórico antes de repetir.", 409);
    if (action.expiresAt.getTime() < Date.now()) fail("Comando expirado; solicite novamente", 409);
    if (!confirm) { const [cancelled] = await tx.update(aiActions).set({ status: "cancelada" }).where(eq(aiActions.id, id)).returning(); return { action: cancelled, done: true }; }
    const [processing] = await tx.update(aiActions).set({ status: "executando" }).where(eq(aiActions.id, id)).returning();
    return { action: processing, done: false };
  });
  if (claimed.done) return { actionId: id, status: claimed.action.status, result: claimed.action.result, complete: true };
  try {
    const current = await freshUser(user), name = String(claimed.action.payload.command), command = commands[name]; assertAllowed(current, command.permission);
    const result = await command.run(current, claimed.action.payload.input, `assistant-${id}`);
    // Commit the durable outcome and audit together. If the process dies after
    // the service commit, 'executando' prevents blind automatic re-execution.
    await db.transaction(async tx => {
      await tx.update(aiActions).set({ status: "executada", result }).where(and(eq(aiActions.id, id), eq(aiActions.companyId, user.companyId)));
      await audit(tx, current, "comando_assistente_executado", { actionId: id, command: name });
    });
    return { actionId: id, status: "executada", result, complete: true };
  } catch (cause) {
    const reason = cause instanceof AuthError ? `${cause.message}. ` : cause instanceof z.ZodError ? "Os dados não passaram na validação. " : "";
    const error = `${reason}Operação não confirmou conclusão. Confira o histórico e os registros antes de repetir; não houve nova tentativa automática.`;
    await db.update(aiActions).set({ status: "verificar", error }).where(eq(aiActions.id, id));
    return { actionId: id, status: "verificar", error, complete: false };
  }
}
export function commandTools(user: SessionUser, threadId: string, request: string): ToolSet {
  return Object.fromEntries(Object.entries(commands).filter(([, c]) => allowed(user, c.permission)).map(([name, c]) => [name, tool({ description: `${c.description} ${c.confirmation ? "Cria prévia para confirmação na conversa." : "Executa diretamente, registra resultado e auditoria."}`, inputSchema: c.schema, execute: input => submitCommand(user, threadId, request, name, input) })]));
}
