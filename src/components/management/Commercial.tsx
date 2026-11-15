"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { money, Badge } from "@/components/ui";
import type { commercialData } from "@/lib/erp/commercial";
import type { RentalLine } from "@/lib/erp/types";
import { useModule, Form, Area, Disclosure, Card, Button, Input, Select, Spinner, value, nullable, amount, today, dateLabel, Actions, Download, MoneyField, List, type Options } from "./shared";
type Data = Awaited<ReturnType<typeof commercialData>>;
type Doc = Data["documents"][number];
export function Commercial({ options }: { options: Options }) {
  const api = useModule<Data>("comercial");
  const [lines, setLines] = useState<RentalLine[]>([]), [link, setLink] = useState("");
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("documento");
    if (id && api.data) document.getElementById(`documento-${id}`)?.scrollIntoView({ block: "start" });
  }, [api.data]);
  function addLine(f: FormData) {
    const product = options.products.find(p => p.id === value(f, "product"));
    if (!product) return;
    setLines(old => [...old, { catalogItemId: product.id, name: product.name, unit: product.unit, qty: Number(value(f, "qty")), priceCents: product.rentalPriceCents ?? 0, periods: 1 }]);
  }
  return <div className="space-y-4">{api.feedback}{link && <Card><p className="text-sm">Link válido por 30 dias. Ao gerar outro, o anterior é revogado.</p><a href={link} target="_blank" rel="noreferrer" className="break-all font-semibold text-action underline">{link}</a></Card>}
    <Disclosure title="Novo orçamento">
      <form className="mb-4 grid items-end gap-3 sm:grid-cols-3" onSubmit={e => { e.preventDefault(); addLine(new FormData(e.currentTarget)); }}>
        <Select name="product" label="Produto" required><option value="">Selecione</option>{options.products.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name} · {p.rentalPriceCents === null ? "preço não cadastrado" : money(p.rentalPriceCents)}</option>)}</Select>
        <Input name="qty" label="Quantidade" type="number" min="1" max="100000" defaultValue="1" required /><Button type="submit" variant="secondary">Adicionar item</Button>
      </form>
      <p className="mb-2 text-xs text-slate-500">Informe o preço e a quantidade de períodos cobrados em cada linha. O estoque será reservado ao emitir o contrato.</p>
      {lines.map((l, i) => <div key={i} className="mb-3 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-4"><p className="self-center text-sm font-semibold">{l.name} ({l.qty} {l.unit})</p>
        <Input label="Preço unitário (R$)" inputMode="decimal" value={(l.priceCents / 100).toFixed(2)} onChange={e => { const n = Number(e.target.value.replace(",", ".")); if (Number.isFinite(n) && n >= 0) setLines(old => old.map((v, j) => j === i ? { ...v, priceCents: Math.round(n * 100) } : v)); }} />
        <Input label="Períodos" type="number" min="1" value={l.periods} onChange={e => setLines(old => old.map((v, j) => j === i ? { ...v, periods: Number(e.target.value) } : v))} />
        <Button variant="ghost" onClick={() => setLines(old => old.filter((_, j) => j !== i))}>Remover</Button></div>)}
      <Form busy={api.busy} label="Salvar orçamento" onSubmit={async f => { const result = await api.run({ action: "criar", customerId: value(f, "customerId"), sellerId: nullable(f, "sellerId"), eventName: value(f, "eventName"), eventDate: value(f, "eventDate"), returnDueDate: value(f, "returnDueDate"), validUntil: value(f, "validUntil") || undefined, deliveryAddress: value(f, "deliveryAddress"), deliveryCents: amount(f, "delivery"), discountCents: amount(f, "discount"), terms: value(f, "terms"), notes: value(f, "notes"), lines }); if (result) setLines([]); }}>
        <Select label="Cliente" name="customerId" required><option value="">Selecione</option>{options.customers.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select label="Vendedor / atendente" name="sellerId"><option value="">Sem vendedor</option>{options.team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
        <Input label="Evento" name="eventName" required /><Input label="Validade da proposta" name="validUntil" type="date" />
        <Input label="Início da locação" name="eventDate" type="date" required /><Input label="Devolução" name="returnDueDate" type="date" required />
        <MoneyField label="Entrega (R$)" name="delivery" defaultValue="0" /><MoneyField label="Desconto (R$)" name="discount" defaultValue="0" />
        <Area label="Endereço de entrega" name="deliveryAddress" /><Area label="Condições / cláusulas (ou use o modelo das configurações)" name="terms" /><Area label="Observações internas" name="notes" />
      </Form>
    </Disclosure>
    {!api.data && !api.error && <Spinner />}
    {api.data && <List count={api.data.documents.length} empty="Nenhum orçamento ou contrato emitido.">{api.data.documents.map(doc => <Card key={doc.id} id={`documento-${doc.id}`} className="scroll-mt-28">
      <div className="flex flex-wrap justify-between gap-2"><div><p className="text-xs font-bold uppercase text-action">{doc.kind} #{doc.number}</p><h2 className="font-semibold">{doc.eventName}</h2><p className="text-sm text-slate-600">{doc.customerName} · {dateLabel(doc.eventDate)} a {dateLabel(doc.returnDueDate)}</p></div><div><p className="font-bold">{money(doc.totalCents)}</p><Badge status={doc.status} /></div></div>
      <Actions><Download href={`/api/gestao/documentos?id=${doc.id}`}>PDF / imprimir</Download><Button variant="secondary" disabled={api.busy || doc.status === "cancelado"} onClick={async () => { const result = await api.run<{ path: string }>({ action: "compartilhar", id: doc.id }, "Link gerado"); if (result) setLink(window.location.origin + result.path); }}>Gerar link</Button>{doc.orderId && <Link className="self-center text-center font-semibold text-action underline" href={`/pedidos/${doc.orderId}`}>Conferir pedido</Link>}</Actions>
      {doc.status !== "cancelado" && <>
        <Actions>{["email", "whatsapp"].map(channel => <Button key={channel} variant="secondary" disabled={api.busy} onClick={() => void api.run({ action: "enviar", id: doc.id, channel, requestKey: crypto.randomUUID() }, "Provedor aceitou o envio. Acompanhe no histórico.")}>Enviar por {channel === "email" ? "e-mail" : "WhatsApp"}</Button>)}</Actions>
        {doc.kind === "orcamento" && doc.status !== "contratado" && <><p className="my-2 text-sm">Acessos únicos estimados: {doc.visitCount} {doc.lastVisit ? `· último ${dateLabel(doc.lastVisit)}` : ""}. Recargas em 30 minutos e prévias reconhecidas são filtradas.</p><Button disabled={api.busy} variant="secondary" onClick={() => void api.run({ action: doc.reservationOrderId ? "liberar_reserva" : "reservar", id: doc.id }, doc.reservationOrderId ? "Reserva liberada" : "Estoque reservado para o período")}>{doc.reservationOrderId ? "Liberar reserva de estoque" : "Reservar estoque desta proposta"}</Button><RevisionForm doc={doc} busy={api.busy} run={api.run} /><ContractForm doc={doc} busy={api.busy} run={api.run} /></>}
        {doc.kind === "contrato" && <div className="mt-3 rounded-xl bg-slate-50 p-3"><p className="text-sm">Assinatura: {doc.signedAt ? `confirmada em ${dateLabel(doc.signedAt)}` : doc.signature?.status ?? "não solicitada"}</p><Actions>
          <Button variant="secondary" disabled={api.busy} onClick={() => void api.run({ action: "assinar", id: doc.id }, "Solicitação aceita pelo provedor; consulte o link de assinatura.")}>Solicitar assinatura</Button>
          <Button variant="secondary" disabled={api.busy || !doc.signature?.token} onClick={() => void api.run({ action: "consultar_assinatura", id: doc.id }, "Status consultado no provedor")}>Consultar assinatura</Button>
          {doc.signature?.signUrl && <Download href={doc.signature.signUrl}>Abrir assinatura</Download>}{doc.signedAt && <Download href={`/api/gestao/documentos?id=${doc.id}&signed=1`}>PDF assinado</Download>}
        </Actions></div>}
        {doc.status !== "contratado" && <details className="mt-3"><summary className="cursor-pointer py-2 text-sm font-semibold text-red-700">Cancelar documento</summary><Form busy={api.busy} label="Confirmar cancelamento" onSubmit={f => api.run({ action: "cancelar", id: doc.id, reason: value(f, "reason") })}><Input label="Motivo" name="reason" required minLength={3} /></Form></details>}
      </>}
    </Card>)}</List>}
  </div>;
}
function ContractForm({ doc, busy, run }: { doc: Doc; busy: boolean; run: ReturnType<typeof useModule<Data>>["run"] }) {
  const [installments, setInstallments] = useState([{ dueDate: doc.eventDate < today() ? today() : doc.eventDate, amountCents: doc.totalCents }]);
  return <details className="mt-3"><summary className="cursor-pointer py-2 font-semibold text-action">Emitir contrato e parcelas</summary>
    <div className="my-3 space-y-2">{installments.map((p, i) => <div key={i} className="grid gap-2 sm:grid-cols-3"><Input label={`Vencimento ${i + 1}`} type="date" value={p.dueDate} onChange={e => setInstallments(old => old.map((v, j) => j === i ? { ...v, dueDate: e.target.value } : v))} /><Input label="Valor (R$)" inputMode="decimal" value={(p.amountCents / 100).toFixed(2)} onChange={e => { const n = Number(e.target.value.replace(",", ".")); if (Number.isFinite(n) && n >= 0) setInstallments(old => old.map((v, j) => j === i ? { ...v, amountCents: Math.round(n * 100) } : v)); }} /><Button variant="ghost" onClick={() => setInstallments(old => old.filter((_, j) => j !== i))}>Remover parcela</Button></div>)}<Button variant="secondary" onClick={() => setInstallments(old => [...old, { dueDate: doc.eventDate, amountCents: Math.max(0, doc.totalCents - old.reduce((a, p) => a + p.amountCents, 0)) }])}>Adicionar parcela</Button><p className="text-sm">Soma: {money(installments.reduce((a, p) => a + p.amountCents, 0))} de {money(doc.totalCents)}</p></div>
    <Form busy={busy} label="Emitir contrato e reservar estoque" onSubmit={f => run({ action: "contratar", id: doc.id, installments, commissionBps: value(f, "rate") === "" ? undefined : Math.round(Number(value(f, "rate").replace(",", ".")) * 100), commissionBasis: value(f, "basis") || undefined, terms: value(f, "terms") || undefined }, "Contrato, pedido e parcelas emitidos")}>
      <Input label="Comissão (%) · vazio usa configuração" name="rate" inputMode="decimal" placeholder="0 para sem comissão" /><Select label="Comissão devida por" name="basis"><option value="">Usar configuração</option><option value="recebimento">Recebimento proporcional</option><option value="contrato">Emissão do contrato</option></Select><Area label="Cláusulas (vazio usa o modelo configurado)" name="terms" />
    </Form>
  </details>;
}

function RevisionForm({ doc, busy, run }: { doc: Doc; busy: boolean; run: ReturnType<typeof useModule<Data>>["run"] }) {
  return <details className="mt-3"><summary className="cursor-pointer py-2 font-semibold text-action">Revisar proposta</summary><p className="mb-3 text-xs text-slate-600">A revisão revoga o link anterior e solicita um novo aceite.</p><Form busy={busy} label="Salvar revisão" onSubmit={f => run({ action: "revisar", id: doc.id, customerId: doc.customerId, sellerId: doc.sellerId, eventName: value(f, "eventName"), eventDate: value(f, "eventDate"), returnDueDate: value(f, "returnDueDate"), validUntil: value(f, "validUntil") || undefined, deliveryAddress: value(f, "address"), deliveryCents: amount(f, "delivery"), discountCents: amount(f, "discount"), terms: value(f, "terms"), notes: doc.notes,
    lines: doc.lines.map((l, i) => ({ ...l, qty: Number(value(f, `qty${i}`)), periods: Number(value(f, `periods${i}`)), priceCents: amount(f, `price${i}`) })) })}>
    <Input label="Evento" name="eventName" defaultValue={doc.eventName} required /><Input label="Validade" name="validUntil" type="date" defaultValue={doc.validUntil ?? ""} />
    <Input label="Início" name="eventDate" type="date" defaultValue={doc.eventDate} required /><Input label="Devolução" name="returnDueDate" type="date" defaultValue={doc.returnDueDate} required />
    {doc.lines.map((l, i) => <div key={i} className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:col-span-2 sm:grid-cols-3"><p className="font-semibold sm:col-span-3">{l.name}</p><Input label="Quantidade" name={`qty${i}`} type="number" min="1" defaultValue={l.qty} required /><MoneyField label="Preço unitário (R$)" name={`price${i}`} defaultValue={(l.priceCents / 100).toFixed(2)} /><Input label="Períodos" name={`periods${i}`} type="number" min="1" defaultValue={l.periods} required /></div>)}
    <MoneyField label="Entrega (R$)" name="delivery" defaultValue={(doc.deliveryCents / 100).toFixed(2)} /><MoneyField label="Desconto (R$)" name="discount" defaultValue={(doc.discountCents / 100).toFixed(2)} /><Area label="Endereço de entrega" name="address" defaultValue={doc.deliveryAddress} /><Area label="Condições" name="terms" defaultValue={doc.terms} />
  </Form></details>;
}
