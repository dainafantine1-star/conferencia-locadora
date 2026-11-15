import { z } from "zod";
import { cents, uuid, fail, assertSafeCents } from "@/lib/erp/common";
import type { FiscalAddress, FiscalPreferences, FiscalSnapshot } from "./types";

export const states = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;
const text = (max: number) => z.string().trim().max(max);
export const federalId = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
export function sameFiscal(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, canonical(value)])) : v;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export function validFederalId(raw: string) {
  const id = federalId(raw);
  if (/^(\d)\1+$/.test(id)) return false;
  if (/^\d{11}$/.test(id)) {
    const digit = (n: number) => { const sum = [...id.slice(0, n)].reduce((s, v, i) => s + Number(v) * (n + 1 - i), 0); const r = sum * 10 % 11; return r === 10 ? 0 : r; };
    return digit(9) === Number(id[9]) && digit(10) === Number(id[10]);
  }
  if (!/^[A-Z0-9]{12}\d{2}$/.test(id)) return false;
  const digit = (n: number) => { const weights = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; const r = [...id.slice(0, n)].reduce((sum, v, i) => sum + (v.charCodeAt(0) - 48) * weights[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  return digit(12) === Number(id[12]) && digit(13) === Number(id[13]);
}
export const addressSchema = z.object({ street: text(200), number: text(30), complement: text(100), district: text(100), city: text(100), cityCode: z.string().regex(/^$|^\d{7}$/), state: z.union([z.literal(""), z.enum(states)]), zip: z.string().regex(/^$|^\d{8}$/) }).strict();
export const emitterSchema = addressSchema.extend({ taxId: text(25).transform(federalId), name: text(200), stateRegistration: text(30), taxRegime: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }).strict();
export const recipientSchema = addressSchema.extend({ name: text(200).min(2), taxId: text(25).transform(federalId), stateRegistration: text(30), ieIndicator: z.union([z.literal(1), z.literal(2), z.literal(9)]), phone: text(40), email: z.union([z.literal(""), z.email()]) }).strict();
export function checkedAddress(a: FiscalAddress, label: string) {
  if (!a.street || !a.number || !a.district || !a.city || !/^\d{7}$/.test(a.cityCode) || !states.includes(a.state as typeof states[number]) || !/^\d{8}$/.test(a.zip)) fail(`Complete o endereço fiscal de ${label}, incluindo código IBGE, UF e CEP`);
}
export const jsonFields = z.record(z.string(), z.unknown()).refine(v => JSON.stringify(v).length <= 40000, "Campos fiscais excedem o limite");
const protectedRoot = new Set(["items", "itens", "data_emissao", "natureza_operacao", "tipo_documento", "finalidade_emissao", "local_destino", "consumidor_final", "presenca_comprador", "modalidade_frete", "notas_referenciadas", "informacoes_adicionais_contribuinte", "valor_produtos", "valor_total", "valor_frete", "valor_seguro", "valor_desconto", "valor_outras_despesas", "numero", "serie", "numero_nfe", "referencia", "ref"]);
const protectedItem = new Set(["numero_item", "codigo_produto", "descricao", "codigo_ncm", "cfop", "unidade_comercial", "quantidade_comercial", "valor_unitario_comercial", "valor_bruto", "icms_origem", "inclui_no_total", "valor_frete", "valor_seguro", "valor_desconto", "valor_outras_despesas", "quantidade_tributavel", "unidade_tributavel", "valor_unitario_tributavel"]);
export function safeFields(fields: Record<string, unknown>, item: boolean) {
  function scan(value: unknown, depth = 0): void {
    if (depth > 10) fail("Campos fiscais muito profundos");
    if (Array.isArray(value)) { if (value.length > 200) fail("Campos fiscais excedem o limite"); value.forEach(v => scan(v, depth + 1)); }
    else if (value && typeof value === "object") for (const [key, v] of Object.entries(value)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || ["constructor", "prototype", "__proto__"].includes(key)) fail("Nome de campo fiscal inválido"); scan(v, depth + 1);
    } else if (!["string", "number", "boolean"].includes(typeof value) && value !== null) fail("Valor fiscal inválido");
  }
  scan(fields);
  for (const key of Object.keys(fields)) if ((item ? protectedItem : protectedRoot).has(key) || !item && /(?:emitente|destinatario)$/.test(key)) fail(`O campo ${key} é preenchido pelo sistema; remova dos campos adicionais`);
  return fields;
}
export const profileSchema = z.object({ id: uuid, name: text(120).min(2), active: z.boolean(), reviewed: z.boolean(), nature: text(60).min(2),
  direction: z.union([z.literal(0), z.literal(1)]), purpose: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  internalCfop: z.string().regex(/^$|^[15]\d{3}$/), interstateCfop: z.string().regex(/^$|^[26]\d{3}$/),
  finalConsumer: z.union([z.literal(0), z.literal(1)]), buyerPresence: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(9)]),
  freightMode: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(9)]),
  itemTaxes: jsonFields, extraFields: jsonFields,
}).strict().superRefine((p, ctx) => {
  if (p.internalCfop && p.internalCfop[0] !== (p.direction ? "5" : "1") || p.interstateCfop && p.interstateCfop[0] !== (p.direction ? "6" : "2")) ctx.addIssue({ code: "custom", message: "CFOP incompatível com entrada/saída do perfil" });
  if (p.active && (!p.reviewed || !p.internalCfop && !p.interstateCfop)) ctx.addIssue({ code: "custom", message: "Revise a tributação e informe CFOP antes de ativar o perfil" });
  safeFields(p.itemTaxes, true); safeFields(p.extraFields, false);
});
export const preferencesSchema = z.object({ environment: z.enum(["homologacao", "producao"]), productionEnabled: z.boolean(), emitter: emitterSchema,
  profiles: z.array(profileSchema).max(50), products: z.array(z.object({ catalogItemId: uuid, ncm: z.string().regex(/^\d{8}$/), unit: text(6).min(1), origin: z.number().int().min(0).max(8), taxes: jsonFields }).strict()).max(10000),
  whatsappTemplate: z.string().regex(/^[a-z0-9_]*$/).max(100), whatsappLanguage: z.string().regex(/^[a-z]{2}(?:_[A-Z]{2})?$/), whatsappBodyParameters: z.array(text(1000).min(1)).max(10),
}).strict().superRefine((p, ctx) => {
  if (new Set(p.profiles.map(x => x.id)).size !== p.profiles.length || new Set(p.products.map(x => x.catalogItemId)).size !== p.products.length) ctx.addIssue({ code: "custom", message: "Perfis ou produtos fiscais repetidos" });
  p.products.forEach(x => safeFields(x.taxes, true));
});
export const emptyAddress = { street: "", number: "", complement: "", district: "", city: "", cityCode: "", state: "", zip: "" };
export const defaultPreferences: FiscalPreferences = { environment: "homologacao", productionEnabled: false, emitter: { ...emptyAddress, taxId: "", name: "", stateRegistration: "", taxRegime: 1 }, profiles: [], products: [], whatsappTemplate: "", whatsappLanguage: "pt_BR", whatsappBodyParameters: [] };
export const itemSchema = z.object({ catalogItemId: uuid, name: text(120).min(1), code: text(60).min(1), ncm: z.string().regex(/^\d{8}$/, "NCM deve ter 8 dígitos"), unit: text(6).min(1), origin: z.number().int().min(0).max(8),
  quantity: z.number().positive().max(999999).refine(v => Math.abs(v * 10000 - Math.round(v * 10000)) < 0.00001, "Quantidade permite até 4 casas decimais"), unitPriceCents: cents.refine(v => v > 0, "Informe o valor fiscal unitário do bem"),
  freightCents: cents, insuranceCents: cents, discountCents: cents, otherCents: cents }).strict();
export const draftSchema = z.object({ profileId: uuid, customerId: uuid, orderId: uuid.nullable(), recipient: recipientSchema, items: z.array(itemSchema).min(1).max(200), notes: text(4500), referencedKey: z.string().regex(/^$|^\d{44}$/, "Chave referenciada deve ter 44 dígitos") }).strict();
export function itemCents(item: { quantity: number; unitPriceCents: number }) { return assertSafeCents(Number((BigInt(Math.round(item.quantity * 10000)) * BigInt(item.unitPriceCents) + BigInt(5000)) / BigInt(10000))); }
export function productsCents(items: { quantity: number; unitPriceCents: number }[]) { return assertSafeCents(items.reduce((s, i) => s + itemCents(i), 0)); }
// Somente substituições tipadas de valores; não há execução de código ou expressões.
function substitute(value: unknown, values: Record<string, number | string>): unknown {
  if (typeof value === "string" && /^\{\{.+\}\}$/.test(value)) { const key = value.slice(2, -2); if (!(key in values)) fail(`Variável fiscal desconhecida: ${key}`); return values[key]; }
  if (typeof value === "string" && value.includes("{{")) fail("Use variáveis fiscais como valor completo do campo");
  if (Array.isArray(value)) return value.map(v => substitute(v, values));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, values)]));
  return value;
}
export function buildPayload(snapshot: FiscalSnapshot, environment: FiscalPreferences["environment"], issuedAt: string) {
  const { draft: d, emitter: e, profile: p } = snapshot;
  if (!p.active || !p.reviewed) fail("O perfil fiscal precisa estar ativo e revisado pelo responsável fiscal");
  if (e.taxId.length !== 14 || !validFederalId(e.taxId) || !e.name || !e.stateRegistration) fail("Complete CNPJ válido, razão social e inscrição estadual do emitente");
  checkedAddress(e, "emitente"); checkedAddress(d.recipient, "destinatário");
  const r = d.recipient;
  if (!validFederalId(r.taxId)) fail("CPF/CNPJ do destinatário inválido");
  if (r.ieIndicator === 1 && !r.stateRegistration) fail("Informe a inscrição estadual do destinatário contribuinte");
  if (p.purpose !== 1 && !d.referencedKey) fail("Informe a chave da NF-e referenciada para esta finalidade");
  const cfop = r.state === e.state ? p.internalCfop : p.interstateCfop;
  if (!cfop) fail("O perfil não tem CFOP configurado para a UF do destinatário");
  const total = productsCents(d.items);
  const items = d.items.map((i, index) => {
    const gross = itemCents(i); if (i.discountCents > gross) fail("Desconto maior que o valor do item");
    const fields = safeFields({ ...p.itemTaxes, ...snapshot.productTaxes[i.catalogItemId] }, true);
    for (const field of ["icms_situacao_tributaria", "pis_situacao_tributaria", "cofins_situacao_tributaria"]) if (fields[field] === undefined || fields[field] === "") fail(`Configure ${field} no perfil ou no cadastro fiscal do produto`);
    return { ...substitute(fields, { valor_produto: gross / 100, quantidade: i.quantity, valor_unitario: i.unitPriceCents / 100 }) as Record<string, unknown>,
      numero_item: index + 1, codigo_produto: i.code, descricao: i.name, codigo_ncm: i.ncm, cfop,
      unidade_comercial: i.unit, quantidade_comercial: i.quantity, valor_unitario_comercial: i.unitPriceCents / 100, valor_bruto: gross / 100,
      unidade_tributavel: i.unit, quantidade_tributavel: i.quantity, valor_unitario_tributavel: i.unitPriceCents / 100,
      icms_origem: i.origin, inclui_no_total: 1, valor_frete: i.freightCents / 100, valor_seguro: i.insuranceCents / 100, valor_desconto: i.discountCents / 100, valor_outras_despesas: i.otherCents / 100 };
  });
  return { ...substitute(safeFields(p.extraFields, false), { valor_produtos: total / 100 }) as Record<string, unknown>,
    natureza_operacao: p.nature, data_emissao: issuedAt, tipo_documento: p.direction, finalidade_emissao: p.purpose,
    local_destino: e.state === r.state ? 1 : 2, consumidor_final: p.finalConsumer, presenca_comprador: p.buyerPresence, modalidade_frete: p.freightMode,
    cnpj_emitente: e.taxId, nome_emitente: e.name, inscricao_estadual_emitente: e.stateRegistration, regime_tributario_emitente: e.taxRegime,
    logradouro_emitente: e.street, numero_emitente: e.number, complemento_emitente: e.complement, bairro_emitente: e.district, municipio_emitente: e.city, codigo_municipio_emitente: e.cityCode, uf_emitente: e.state, cep_emitente: e.zip,
    nome_destinatario: environment === "homologacao" ? "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL" : r.name,
    [r.taxId.length === 11 ? "cpf_destinatario" : "cnpj_destinatario"]: r.taxId,
    indicador_inscricao_estadual_destinatario: r.ieIndicator, ...(r.ieIndicator === 1 ? { inscricao_estadual_destinatario: r.stateRegistration } : {}),
    logradouro_destinatario: r.street, numero_destinatario: r.number, complemento_destinatario: r.complement, bairro_destinatario: r.district, municipio_destinatario: r.city, codigo_municipio_destinatario: r.cityCode, uf_destinatario: r.state, cep_destinatario: r.zip, pais_destinatario: "Brasil",
    ...(r.email ? { email_destinatario: r.email } : {}), ...(r.phone ? { telefone_destinatario: r.phone.replace(/\D/g, "") } : {}),
    items, valor_produtos: total / 100, informacoes_adicionais_contribuinte: d.notes,
    ...(d.referencedKey ? { notas_referenciadas: [{ chave_nfe: d.referencedKey }] } : {}),
  };
}
