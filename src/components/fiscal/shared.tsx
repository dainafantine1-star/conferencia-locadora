"use client";
import { Input, Select } from "@/components/ui";
import type { FiscalAddress, FiscalItemInput } from "@/lib/fiscal/types";
import type { fiscalData, InvoiceRow } from "@/lib/fiscal/invoices";
export type FiscalData = Awaited<ReturnType<typeof fiscalData>>;
export type Invoice = FiscalData["invoices"][number];
export type Detail = { invoice: Invoice; preview: Record<string, unknown>; deliveries: FiscalData["deliveries"] };
export const blankAddress: FiscalAddress = { street: "", number: "", complement: "", district: "", city: "", cityCode: "", state: "", zip: "" };
export const stateOptions = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
export const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const fiscalLabels: Record<InvoiceRow["status"], string> = { rascunho: "Rascunho", enviando: "Solicitando emissão", processando: "Em processamento", autorizada: "Autorizada", rejeitada: "Rejeitada", incerta: "Resultado incerto", cancelada: "Cancelada", denegada: "Denegada" };
export function AddressFields({ value, onChange }: { value: FiscalAddress; onChange: (patch: Partial<FiscalAddress>) => void }) {
  return <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-3 font-semibold">Endereço fiscal</legend>
    {([["street", "Logradouro"], ["number", "Número"], ["complement", "Complemento"], ["district", "Bairro"], ["city", "Município"], ["cityCode", "Código IBGE do município"], ["zip", "CEP (8 dígitos)"]] as const).map(([key, label]) => <Input key={key} label={label} value={value[key]} required={key !== "complement"} onChange={e => onChange({ [key]: e.target.value })} maxLength={key === "cityCode" ? 7 : key === "zip" ? 8 : 200} inputMode={key === "cityCode" || key === "zip" ? "numeric" : undefined} pattern={key === "cityCode" ? "[0-9]{7}" : key === "zip" ? "[0-9]{8}" : undefined} />)}
    <Select label="UF" required value={value.state} onChange={e => onChange({ state: e.target.value })}><option value="">Selecione</option>{stateOptions.map(s => <option key={s}>{s}</option>)}</Select>
  </fieldset>;
}
export function CentsField({ label, value, onChange, required = false }: { label: string; value: number; onChange: (v: number) => void; required?: boolean }) {
  return <Input label={label} type="number" inputMode="decimal" min={required ? "0.01" : "0"} step="0.01" max="9999999" required={required} value={value === 0 && required ? "" : value / 100} onChange={e => onChange(Math.round(Number(e.target.value) * 100))} />;
}
export const lineTotal = (item: FiscalItemInput) => Math.round(item.quantity * item.unitPriceCents);
