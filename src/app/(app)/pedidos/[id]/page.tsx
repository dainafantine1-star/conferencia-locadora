"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, Badge, Spinner, Button, money, useToast, EmptyState } from "@/components/ui";

type Detail = {
  order: {
    id: string;
    number: number;
    status: string;
    billingStatus: string;
    eventName: string;
    eventDate: string;
    returnDueDate: string;
    notes: string | null;
    closedAt: string | null;
  };
  customer: { name: string; phone: string } | null;
  items: { id: string; name: string; unit: string; qtyPlanned: number; qtyDelivered: number | null }[];
  balances: {
    orderItemId: string;
    name: string;
    unit: string;
    qtyPlanned: number;
    qtyDelivered: number;
    qtyGood: number;
    qtyDamaged: number;
    qtyOpen: number;
    replacementCents: number | null;
    damageCents: number | null;
  }[];
  closing: { missingQty: number; damagedQty: number; goodQty: number; suggestedCents: number };
  returns: {
    id: string;
    occurredAt: string;
    notes: string | null;
    items: { orderItemId: string; qtyGood: number; qtyDamaged: number }[];
    attachments: { id: string; filename: string; storedName: string }[];
  }[];
  closure: {
    id: string;
    suggestedCents: number;
    finalCents: number;
    adjustmentCents: number;
    adjustmentReason: string | null;
    missingQty: number;
    damagedQty: number;
    closedAt: string;
  } | null;
  billingEvents: { id: string; status: string; amountCents: number | null; note: string; createdAt: string }[];
};

export default function PedidoDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const { toast, el } = useToast();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showReopen, setShowReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustCents, setAdjustCents] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [summary, setSummary] = useState<{ text: string; whatsappUrl: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pedidos/${id}`);
      if (!res.ok) throw new Error((await res.json()).error || "Falha");
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function setBilling(status: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/pedidos/${id}/cobranca`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", status, note: "" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast("Cobrança atualizada");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    if (!reopenReason.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pedidos/${id}/reabrir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reopenReason }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast("Pedido reaberto");
      setShowReopen(false);
      setReopenReason("");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  async function adjust() {
    const cents = Math.round(parseFloat(adjustCents.replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents < 0 || !adjustReason.trim()) {
      toast("Informe valor e justificativa");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/pedidos/${id}/cobranca`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adjust", adjustmentCents: cents, reason: adjustReason }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast("Ajuste aplicado");
      setShowAdjust(false);
      setAdjustCents("");
      setAdjustReason("");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  async function loadSummary() {
    const res = await fetch(`/api/pedidos/${id}/resumo`);
    const d = await res.json();
    if (!res.ok) {
      toast(d.error || "Erro");
      return;
    }
    setSummary(d);
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
    );
  }
  if (!data) return <Spinner label="Carregando pedido…" />;

  const { order, customer, items, balances, closing, returns, closure } = data;
  const isOperator = false; // botões sensíveis aparecem; servidor valida o papel

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Pedido #{order.number}</h1>
          <p className="text-sm text-slate-500">
            {customer?.name} · {order.eventName}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge status={order.status} />
          <Badge status={order.billingStatus} />
        </div>
      </div>

      <Card className="text-sm space-y-1">
        <p><span className="font-medium">Evento:</span> {fmt(order.eventDate)}</p>
        <p><span className="font-medium">Retorno previsto:</span> {fmt(order.returnDueDate)}</p>
        {order.notes && <p className="text-slate-500">{order.notes}</p>}
      </Card>

      {order.status === "rascunho" && (
        <Link href={`/pedidos/${order.id}/saida`}>
          <Button>Confirmar conferência de saída</Button>
        </Link>
      )}

      {order.status === "aberto" && (
        <>
          <Card>
            <h2 className="mb-2 font-semibold">Saldo em aberto</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1">Item</th>
                  <th className="py-1 text-right">Saiu</th>
                  <th className="py-1 text-right">Bom</th>
                  <th className="py-1 text-right">Avar.</th>
                  <th className="py-1 text-right">Aberto</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.orderItemId} className="border-t border-slate-100">
                    <td className="py-1.5 pr-1">{b.name}</td>
                    <td className="py-1.5 text-right">{b.qtyDelivered}</td>
                    <td className="py-1.5 text-right text-emerald-700">{b.qtyGood}</td>
                    <td className="py-1.5 text-right text-amber-700">{b.qtyDamaged}</td>
                    <td className={`py-1.5 text-right font-bold ${b.qtyOpen > 0 ? "text-red-600" : "text-slate-400"}`}>
                      {b.qtyOpen}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">
              Aberto total: <strong>{closing.missingQty}</strong> · Avarias:{" "}
              <strong>{closing.damagedQty}</strong> · Bons: <strong>{closing.goodQty}</strong>
            </p>
          </Card>

          <div className="grid gap-2">
            <Link href={`/pedidos/${order.id}/retorno`}>
              <Button>Registrar devolução</Button>
            </Link>
            <Link href={`/pedidos/${order.id}/fechamento`}>
              <Button variant="secondary">Revisar e encerrar</Button>
            </Link>
          </div>
        </>
      )}

      {order.status === "encerrado" && closure && (
        <Card className="space-y-3">
          <h2 className="font-semibold">Fechamento</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="text-slate-500">Faltantes</p>
              <p className="text-lg font-bold">{closure.missingQty}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="text-slate-500">Avariadas</p>
              <p className="text-lg font-bold">{closure.damagedQty}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="text-slate-500">Sugerido</p>
              <p className="text-lg font-bold">{money(closure.suggestedCents)}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-2">
              <p className="text-slate-500">Final</p>
              <p className="text-lg font-bold text-emerald-800">{money(closure.finalCents)}</p>
            </div>
          </div>
          {closure.adjustmentCents > 0 && (
            <p className="text-sm text-amber-700">
              Ajuste de {money(closure.adjustmentCents)}
              {closure.adjustmentReason ? `: ${closure.adjustmentReason}` : ""}
            </p>
          )}

          <div className="space-y-2">
            <Button variant="secondary" onClick={loadSummary}>
              Gerar resumo (WhatsApp)
            </Button>
            {summary && (
              <div className="space-y-2">
                <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs">
                  {summary.text}
                </pre>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(summary.text);
                      toast("Resumo copiado");
                    }}
                  >
                    Copiar
                  </Button>
                  <a href={summary.whatsappUrl} target="_blank" rel="noopener noreferrer">
                    <Button>Abrir WhatsApp</Button>
                  </a>
                </div>
              </div>
            )}
          </div>

          {data.order.billingStatus === "pendente" && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setBilling("recebida")}>
                Marcar recebida
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setBilling("dispensada")}>
                Dispensar
              </Button>
            </div>
          )}

          <div className="grid gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowAdjust((v) => !v)}>
              Ajustar cobrança…
            </Button>
            {showAdjust && (
              <Card className="space-y-2">
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="Valor do ajuste (R$)"
                  value={adjustCents}
                  onChange={(e) => setAdjustCents(e.target.value)}
                  inputMode="decimal"
                />
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="Justificativa"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                />
                <Button onClick={adjust} disabled={busy}>
                  Aplicar ajuste
                </Button>
              </Card>
            )}
            <Button variant="ghost" onClick={() => setShowReopen((v) => !v)}>
              Reabrir pedido…
            </Button>
            {showReopen && (
              <Card className="space-y-2">
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="Motivo da reabertura"
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                />
                <Button variant="danger" onClick={reopen} disabled={busy}>
                  Confirmar reabertura
                </Button>
              </Card>
            )}
          </div>
        </Card>
      )}

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          Histórico de devoluções
        </h2>
        {returns.length === 0 ? (
          <EmptyState title="Nenhuma devolução ainda" />
        ) : (
          <ul className="space-y-2">
            {returns.map((r, i) => (
              <li key={r.id}>
                <Card>
                  <div className="flex justify-between">
                    <p className="font-semibold">Devolução {i + 1}</p>
                    <span className="text-xs text-slate-400">
                      {new Date(r.occurredAt).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <ul className="mt-1 text-sm text-slate-600">
                    {r.items.map((ri) => {
                      const item = items.find((x) => x.id === ri.orderItemId);
                      return (
                        <li key={ri.orderItemId}>
                          {item?.name}: +{ri.qtyGood} bom
                          {ri.qtyDamaged > 0 ? `, +${ri.qtyDamaged} avariado` : ""}
                        </li>
                      );
                    })}
                  </ul>
                  {r.notes && <p className="mt-1 text-sm text-slate-500">{r.notes}</p>}
                  {r.attachments.length > 0 && (
                    <div className="mt-2 flex gap-2 overflow-x-auto">
                      {r.attachments.map((a) => (
                        <img
                          key={a.id}
                          src={`/api/uploads/${a.storedName}`}
                          alt={a.filename}
                          className="h-16 w-16 rounded object-cover"
                        />
                      ))}
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.billingEvents.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            Histórico de cobrança
          </h2>
          <ul className="space-y-1 text-sm">
            {data.billingEvents.map((b) => (
              <li key={b.id} className="rounded-lg bg-white p-2 border border-slate-200">
                <Badge status={b.status} />{" "}
                {b.amountCents != null && <strong>{money(b.amountCents)}</strong>}{" "}
                <span className="text-slate-500">{b.note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {el}
    </div>
  );
}

function fmt(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
