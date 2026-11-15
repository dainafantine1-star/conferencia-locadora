"use client";
import { useState } from "react";
import { money } from "@/components/ui";
import type { reportData } from "@/lib/erp/reports";
import { useModule, Form, Card, Input, Spinner, value, today, Download, Disclosure } from "./shared";
export function Reports() {
  const [range, setRange] = useState({ start: `${today().slice(0, 7)}-01`, end: today() });
  const query = `?start=${range.start}&end=${range.end}`;
  const api = useModule<Awaited<ReturnType<typeof reportData>>>("relatorios", query);
  const data = api.data;
  const days = [...new Set(data?.cash.map(c => c.day) ?? [])].sort();
  const cash = days.map(day => ({ day, received: data?.cash.filter(c => c.day === day && c.direction === "receber").reduce((a, c) => a + c.amountCents, 0) ?? 0,
    paid: data?.cash.filter(c => c.day === day && c.direction === "pagar").reduce((a, c) => a + c.amountCents, 0) ?? 0 }));
  const max = Math.max(1, ...cash.flatMap(c => [c.received, c.paid]));
  return <div className="space-y-4">{api.feedback}<Card><Form busy={api.busy} label="Atualizar relatório" onSubmit={async f => setRange({ start: value(f, "start"), end: value(f, "end") })}><Input label="De" name="start" type="date" defaultValue={range.start} required /><Input label="Até" name="end" type="date" defaultValue={range.end} required /></Form></Card>{!data && !api.error && <Spinner />}{data && <>
    <div className="grid gap-3 sm:grid-cols-3">{[["Contratado por data do evento", data.totals.contracted], ["Recebido no período", data.totals.received], ["Pago no período", data.totals.paid], ["Resultado de caixa", data.totals.net], ["A receber por vencimento", data.totals.receber], ["A pagar por vencimento", data.totals.pagar]].map(([label, n]) => <Card key={label}><p className="text-xs text-slate-600">{label}</p><p className="text-xl font-bold">{money(Number(n))}</p></Card>)}</div>
    <Card><h2 className="mb-4 font-semibold">Entradas e saídas de caixa por dia</h2><p className="mb-3 text-xs text-slate-600">Verde: recebido · laranja: pago. Inclui as categorias discriminadas no CSV de caixa.</p>{cash.length === 0 ? <p className="text-sm text-slate-600">Nenhuma baixa neste período.</p> : <div className="space-y-3">{cash.map(c => <div key={c.day}><p className="text-xs font-semibold">{c.day.split("-").reverse().join("/")}</p><div className="mt-1 h-3 rounded bg-emerald-600" style={{ width: `${c.received / max * 100}%` }} /><div className="mt-1 h-3 rounded bg-action" style={{ width: `${c.paid / max * 100}%` }} /><p className="text-xs text-slate-600">Recebido {money(c.received)} · pago {money(c.paid)}</p></div>)}</div>}</Card>
    <Disclosure title="Exportar dados do período" open><div className="grid gap-3 sm:grid-cols-2">{[["financeiro", "Contas por vencimento"], ["caixa", "Baixas por data e categoria"], ["vendas", "Contratos por data do evento"], ["estoque", "Disponibilidade no período"]].map(([kind, label]) => <Download key={kind} href={`/api/gestao/relatorios${query}&csv=${kind}`}>{label} · CSV</Download>)}</div><p className="mt-3 text-xs text-slate-600">As colunas de valores usam centavos inteiros. Abra o CSV com separador ponto e vírgula.</p></Disclosure>
    <Card><h2 className="mb-3 font-semibold">Pedidos por situação</h2>{data.orderCounts.map(r => <p key={r.status} className="py-1 text-sm">{r.status}: <strong>{r.count}</strong></p>)}</Card>
  </>}</div>;
}
