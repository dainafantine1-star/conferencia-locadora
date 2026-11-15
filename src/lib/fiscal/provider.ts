import { fail } from "@/lib/erp/common";
import type { FiscalEnvironment, FiscalStatus } from "./types";

export const focusBase = (environment: FiscalEnvironment) => environment === "producao" ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br";
export class FiscalProviderError extends Error {
  constructor(public httpStatus: number, public definitive: boolean, public notFound = false) { super(`O provedor fiscal retornou HTTP ${httpStatus}. Confira as credenciais e a configuração fiscal.`); }
}
export async function boundedBytes(response: Response, maximum = 10 * 1024 * 1024) {
  if (Number(response.headers.get("content-length")) > maximum) fail("Arquivo do provedor excede o limite", 502);
  if (!response.body) fail("Resposta vazia do provedor", 502);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maximum) { await reader.cancel(); fail("Resposta do provedor excede o limite", 502); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function focusRequest(environment: FiscalEnvironment, token: string, reference: string, payload?: Record<string, unknown>) {
  const url = payload ? `${focusBase(environment)}/v2/nfe?ref=${encodeURIComponent(reference)}` : `${focusBase(environment)}/v2/nfe/${encodeURIComponent(reference)}?completa=1`;
  const response = await fetch(url, { method: payload ? "POST" : "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(25000),
    headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`, Accept: "application/json", ...(payload ? { "Content-Type": "application/json" } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  if (!response.ok) throw new FiscalProviderError(response.status, [400,401,403,404,405,413,415,422].includes(response.status), response.status === 404);
  const result: unknown = JSON.parse((await boundedBytes(response, 1024 * 1024)).toString("utf8"));
  if (!result || typeof result !== "object" || Array.isArray(result)) fail("Resposta fiscal inválida. Consulte a referência antes de repetir.", 502);
  return result as Record<string, unknown>;
}
export function fiscalResult(result: Record<string, unknown>, expected: { reference: string; taxId: string }) {
  const value = (key: string, max = 500) => typeof result[key] === "string" || typeof result[key] === "number" ? String(result[key]).slice(0, max) : null;
  if (result.ref !== undefined && result.ref !== expected.reference || result.cnpj_emitente !== undefined && String(result.cnpj_emitente).replace(/[^A-Z0-9]/gi, "").toUpperCase() !== expected.taxId) fail("O provedor retornou documento de outra referência ou emitente", 502);
  const providerStatus = value("status", 80);
  const statuses: Record<string, FiscalStatus> = { autorizado: "autorizada", erro_autorizacao: "rejeitada", processando_autorizacao: "processando", cancelado: "cancelada", denegado: "denegada" };
  const status = providerStatus ? statuses[providerStatus] : undefined;
  if (!status) fail("Status fiscal desconhecido. Consulte novamente antes de emitir outra nota.", 502);
  const accessKey = value("chave_nfe", 60), number = value("numero", 20), series = value("serie", 10);
  if (status === "autorizada" && (!accessKey || !/^\d{44}$/.test(accessKey) || !number || !/^\d+$/.test(number))) fail("Autorização sem chave ou número válido. Consulte novamente.", 502);
  const errors = Array.isArray(result.erros) ? result.erros.slice(0, 8).map(e => e && typeof e === "object" ? [e.codigo, e.mensagem, e.correcao].filter(v => typeof v === "string").join(": ") : "").join("; ") : "";
  const protocolData = result.protocolo && typeof result.protocolo === "object" ? result.protocolo as Record<string, unknown> : {};
  return { status, providerStatus, number, series, accessKey, protocol: value("protocolo_autorizacao", 100) ?? (typeof result.protocolo === "string" ? value("protocolo", 100) : typeof protocolData.numero_protocolo === "string" ? protocolData.numero_protocolo.slice(0, 100) : null),
    pdfPath: value("caminho_danfe", 2000), xmlPath: value("caminho_xml_nota_fiscal", 2000),
    message: [value("mensagem_sefaz", 1500), errors].filter(Boolean).join("; ").slice(0, 3000) || (status === "processando" ? "Aguardando processamento pelo provedor/SEFAZ" : null), checkedAt: new Date() };
}
// Não aceita URLs arbitrárias nem encaminha token a CDN, prefeitura ou redirecionamento.
export function fiscalFileUrl(environment: FiscalEnvironment, file: string) {
  const base = focusBase(environment), url = new URL(file, base);
  if (url.origin !== base || url.username || url.password || url.hash || !url.pathname.startsWith("/arquivos/") || url.pathname.includes("\\")) fail("Endereço de arquivo fiscal não permitido", 502);
  return url.href;
}
export async function focusFile(environment: FiscalEnvironment, token: string, file: string, format: "pdf" | "xml") {
  const response = await fetch(fiscalFileUrl(environment, file), { headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new FiscalProviderError(response.status, true);
  const data = await boundedBytes(response);
  if (format === "pdf" && data.subarray(0, 5).toString() !== "%PDF-") fail("O provedor não retornou um PDF válido", 502);
  if (format === "xml" && (!data.toString("utf8").includes("<nfeProc") || !data.toString("utf8").includes("<protNFe"))) fail("XML autorizado da NF-e não disponível", 502);
  return data;
}
