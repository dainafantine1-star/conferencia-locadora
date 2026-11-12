"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, Button, useToast, Spinner, money } from "@/components/ui";

type Detail = {
  order: { id: string; number: number; status: string };
  balances: {
    orderItemId: string;
    name: string;
    unit: string;
    qtyGood: number;
    qtyDamaged: number;
    qtyOpen: number;
    replacementCents: number | null;
    damageCents: number | null;
  }[];
  closing: {
    missingQty: number;
    damagedQty: number;
    goodQty: number;
    suggestedCents: number;
    perItem: {
      orderItemId: string;
      name: string;
      missingQty: number;
      damagedQty: number;
      missingValueCents: number;
      damagedValueCents: number;
      subtotalCents: number;
    }[];
  };
};

export default function FechamentoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast, el } = useToast();
  const [data, setData] = useState<Detail | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/pedidos/${id}`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  async function close() {
    if (!data) return;
    if (data.closing.missingQty > 0 && !confirmed) {
      setError("Confirme explicitamente a quantidade faltante");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/pedidos/${id}/fechamento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedMissingQty: data.closing.missingQty }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Falha");
      toast("Pedido encerrado");
      setTimeout(() => router.push(`/pedidos/${id}`), 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  if (!data && !error) return <Spinner label="Carregando…" />;
  if (!data) {
    return <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>;
  }

  const { closing, balances } = data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Fechamento do pedido #{data.order.number}</h1>
        <p className="text-sm text-slate-500">
          Revise as ocorrências e confirme as quantidades antes de encerrar.
        </p>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <table className="w-full rounded-xl border border-slate-200 bg-white text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="p-2">Conferência</th>
            <th className="p-2 text-right">Qtd</th>
          </tr>
        </thead>
        <tbody className="font-medium">
          <tr className="border-b border-slate-100">
            <td className="p-2">Devolvidas em bom estado</td>
            <td className="p-2 text-right text-emerald-700">{closing.goodQty}</td>
          </tr>
          <tr className="border-b border-slate-100">
            <td className="p-2">Devolvidas avariadas</td>
            <td className="p-2 text-right text-amber-700">{closing.damagedQty}</td>
          </tr>
          <tr className="border-b border-slate-100 bg-red-50">
            <td className="p-2 font-bold">Faltantes em aberto</td>
            <td className="p-2 text-right font-bold text-red-700">{closing.missingQty}</td>
          </tr>
        </tbody>
      </table>

      <Card>
        <h2 className="mb-2 font-semibold">Cálculo por item</h2>
        <ul className="space-y-2 text-sm">
          {closing.perItem.map((p) => (
            <li key={p.orderItemId} className="rounded-lg bg-slate-50 p-2">
              <p className="font-semibold">{p.name}</p>
              <p className="text-slate-600">
                {p.missingQty > 0 && (
                  <>
                    {p.missingQty} em falta = {money(p.missingValueCents)}
                    <br />
                  </>
                )}
                {p.damagedQty > 0 && (
                  <>
                    {p.damagedQty} avariada(s) = {money(p.damagedValueCents)}
                    <br />
                  </>
                )}
                {p.subtotalCents > 0 ? (
                  <strong>Subtotal {money(p.subtotalCents)}</strong>
                ) : (
                  <span className="text-emerald-700">Sem cobrança</span>
                )}
              </p>
            </li>
          ))}
        </ul>
        <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-right">
          <p className="text-sm text-emerald-800">Reposição sugerida</p>
          <p className="text-2xl font-bold text-emerald-900">{money(closing.suggestedCents)}</p>
        </div>
      </Card>

      {closing.missingQty > 0 && (
        <label className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span className="text-sm text-amber-900">
            Confirmo que <strong>{closing.missingQty}</strong> unidade(s) ficaram em falta e
            autorizo a cobrança de reposição.
          </span>
        </label>
      )}

      <Button
        onClick={close}
        disabled={saving || (closing.missingQty > 0 && !confirmed)}
      >
        {saving ? "Encerrando…" : "Encerrar pedido"}
      </Button>
      {el}
    </div>
  );
}
