"use client";
import { useState } from "react";
import { Button, Card, Input, Select } from "@/components/ui";
import { Area } from "@/components/management/shared";
import type { FiscalDraft, FiscalItemInput } from "@/lib/fiscal/types";
import { AddressFields, blankAddress, CentsField, money, lineTotal, type FiscalData, type Invoice } from "./shared";
export function FiscalDraftForm({ data, invoice, busy, onSave, onCancel }: { data: FiscalData; invoice?: Invoice; busy: boolean; onSave: (draft: FiscalDraft, invoice?: Invoice) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState<FiscalDraft>(() => invoice?.snapshot.draft ?? { profileId: data.profiles[0]?.id ?? "", customerId: "", orderId: null,
    recipient: { ...blankAddress, name: "", taxId: "", stateRegistration: "", ieIndicator: 9, phone: "", email: "" }, items: [], notes: "", referencedKey: "" });
  const [productId, setProductId] = useState(""); const [error, setError] = useState("");
  const profile = data.profiles.find(p => p.id === draft.profileId);
  function recipient(patch: Partial<FiscalDraft["recipient"]>) { setDraft(d => ({ ...d, recipient: { ...d.recipient, ...patch } })); }
  function item(index: number, patch: Partial<FiscalItemInput>) { setDraft(d => ({ ...d, items: d.items.map((v, i) => i === index ? { ...v, ...patch } : v) })); }
  function selectCustomer(id: string) {
    const customer = data.customers.find(c => c.id === id), previous = data.invoices.find(i => i.customerId === id)?.snapshot.draft.recipient;
    setDraft(d => ({ ...d, customerId: id, orderId: null, recipient: { ...blankAddress, ...(previous ?? {}), name: customer?.name ?? "", taxId: customer?.taxId ?? "", phone: customer?.phone ?? "", email: customer?.email ?? "", stateRegistration: previous?.stateRegistration ?? "", ieIndicator: previous?.ieIndicator ?? 9 } }));
  }
  function addProduct() {
    const product = data.products.find(p => p.id === productId); if (!product || draft.items.length >= 200) return;
    const rule = data.productRules.find(p => p.catalogItemId === product.id);
    setDraft(d => ({ ...d, items: [...d.items, { catalogItemId: product.id, name: product.name, code: product.id, ncm: rule?.ncm ?? "", unit: rule?.unit ?? product.unit, origin: rule?.origin ?? -1,
      quantity: 1, unitPriceCents: 0, freightCents: 0, insuranceCents: 0, discountCents: 0, otherCents: 0 }] })); setProductId("");
  }
  return <Card><form className="space-y-5" onSubmit={async e => { e.preventDefault(); setError(""); if (!draft.items.length) { setError("Adicione pelo menos um produto"); return; } await onSave(draft, invoice); }}>
    <h2 className="text-xl font-bold">{invoice ? "Editar rascunho" : "Nova NF-e"}</h2>
    <p className="text-sm text-slate-600">Primeiro salve e revise. A emissão será solicitada em uma etapa separada.</p>
    <fieldset disabled={busy} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2"><Select label="Cliente" required value={draft.customerId} onChange={e => selectCustomer(e.target.value)}><option value="">Selecione</option>{data.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select label="Pedido vinculado (opcional)" value={draft.orderId ?? ""} onChange={e => setDraft(d => ({ ...d, orderId: e.target.value || null }))}><option value="">Sem vínculo</option>{data.orders.filter(o => o.customerId === draft.customerId).map(o => <option key={o.id} value={o.id}>#{o.number} · {o.eventName}</option>)}</Select>
        <Select label="Perfil fiscal" required value={draft.profileId} onChange={e => setDraft(d => ({ ...d, profileId: e.target.value }))}><option value="">Selecione</option>{data.profiles.map(p => <option key={p.id} value={p.id}>{p.name} · {p.direction ? "Saída" : "Entrada"}</option>)}</Select>
        <Input label="Chave da NF-e referenciada (quando aplicável)" value={draft.referencedKey} onChange={e => setDraft(d => ({ ...d, referencedKey: e.target.value }))} pattern="[0-9]{44}" maxLength={44} required={!!profile && profile.purpose !== 1} />
      </div>
      {profile && <p className="rounded-xl bg-cream p-3 text-sm">{profile.nature} · CFOP na mesma UF: {profile.internalCfop || "não configurado"} · Outra UF: {profile.interstateCfop || "não configurado"}</p>}
      <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-3 font-semibold">Destinatário</legend>
        <Input label="Nome / razão social" required value={draft.recipient.name} onChange={e => recipient({ name: e.target.value })} />
        <Input label="CPF / CNPJ" required value={draft.recipient.taxId} onChange={e => recipient({ taxId: e.target.value })} maxLength={25} />
        <Select label="Indicador de inscrição estadual" value={draft.recipient.ieIndicator} onChange={e => recipient({ ieIndicator: Number(e.target.value) as 1 | 2 | 9 })}><option value={9}>Não contribuinte</option><option value={1}>Contribuinte de ICMS</option><option value={2}>Contribuinte isento</option></Select>
        <Input label="Inscrição estadual" value={draft.recipient.stateRegistration} required={draft.recipient.ieIndicator === 1} onChange={e => recipient({ stateRegistration: e.target.value })} />
        <Input label="WhatsApp do destinatário (DDI + DDD)" value={draft.recipient.phone} onChange={e => recipient({ phone: e.target.value })} inputMode="tel" />
        <Input label="E-mail do destinatário" type="email" value={draft.recipient.email} onChange={e => recipient({ email: e.target.value })} />
      </fieldset>
      <AddressFields value={draft.recipient} onChange={recipient} />
      <div className="border-t border-slate-200 pt-4"><h3 className="font-semibold">Produtos e valores fiscais</h3><p className="mt-1 text-sm text-slate-600">Na remessa, informe o valor dos bens definido pela empresa. O preço de locação não é preenchido como valor fiscal.</p>
        <div className="mt-3 grid items-end gap-2 sm:grid-cols-[1fr_auto]"><Select label="Adicionar produto do catálogo" value={productId} onChange={e => setProductId(e.target.value)}><option value="">Selecione</option>{data.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select><Button type="button" variant="secondary" onClick={addProduct} disabled={!productId}>Adicionar produto</Button></div>
      </div>
      {draft.items.map((i, index) => <fieldset key={index} className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-3"><legend className="px-2 text-sm font-bold">Item {index + 1} · {i.name}</legend>
        <Input label="Descrição do produto" required value={i.name} maxLength={120} onChange={e => item(index, { name: e.target.value })} />
        <Input label="Código do produto" required value={i.code} maxLength={60} onChange={e => item(index, { code: e.target.value })} />
        <Input label="NCM (8 dígitos)" required value={i.ncm} pattern="[0-9]{8}" maxLength={8} inputMode="numeric" onChange={e => item(index, { ncm: e.target.value })} />
        <Input label="Unidade fiscal" required value={i.unit} maxLength={6} onChange={e => item(index, { unit: e.target.value })} />
        <Input label="Quantidade" type="number" min="0.0001" max="999999" step="0.0001" required value={i.quantity} onChange={e => item(index, { quantity: Number(e.target.value) })} />
        <CentsField label="Valor fiscal unitário (R$)" required value={i.unitPriceCents} onChange={v => item(index, { unitPriceCents: v })} />
        <Select label="Origem da mercadoria" required value={i.origin < 0 ? "" : i.origin} onChange={e => item(index, { origin: e.target.value === "" ? -1 : Number(e.target.value) })}><option value="">Selecione</option>{["0 · Nacional", "1 · Estrangeira: importação direta", "2 · Estrangeira: mercado interno", "3 · Nacional: importação > 40% e ≤ 70%", "4 · Nacional: processos produtivos básicos", "5 · Nacional: importação ≤ 40%", "6 · Estrangeira direta: sem similar nacional", "7 · Estrangeira interna: sem similar nacional", "8 · Nacional: importação > 70%"].map((label, v) => <option key={v} value={v}>{label}</option>)}</Select>
        <div className="sm:col-span-2 lg:col-span-3"><details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Frete, seguro, desconto e outras despesas deste item</summary><div className="grid gap-3 sm:grid-cols-2">{([["freightCents", "Frete (R$)"], ["insuranceCents", "Seguro (R$)"], ["discountCents", "Desconto (R$)"], ["otherCents", "Outras despesas (R$)"]] as const).map(([k, label]) => <CentsField key={k} label={label} value={i[k]} onChange={v => item(index, { [k]: v })} />)}</div></details></div>
        <p className="self-center text-sm font-semibold">Valor dos produtos: {money(lineTotal(i))}</p><Button variant="ghost" type="button" onClick={() => setDraft(d => ({ ...d, items: d.items.filter((_, n) => n !== index) }))}>Remover item do rascunho</Button>
      </fieldset>)}
      <Area label="Informações complementares da NF-e" value={draft.notes} maxLength={4500} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} />
    </fieldset>
    <p className="text-lg font-bold">Produtos: {money(draft.items.reduce((s, i) => s + lineTotal(i), 0))}</p><p className="text-xs text-slate-600">O total da NF-e considera também despesas, descontos e tributos conforme a configuração fiscal e o cálculo do provedor.</p>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}<div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !data.profiles.length}>{busy ? "Salvando…" : "Salvar e revisar rascunho"}</Button><Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>Voltar para notas</Button></div>
  </form></Card>;
}
