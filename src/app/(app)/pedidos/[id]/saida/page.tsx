"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, Button, useToast, Spinner } from "@/components/ui";
import Scanner from "@/components/Scanner";

type Item = {
  id: string;
  name: string;
  unit: string;
  qtyPlanned: number;
  qtyDelivered: number | null;
};

export default function SaidaPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast, el } = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);

  useEffect(() => {
    fetch(`/api/pedidos/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items);
        // Na saída, começa em 0 para bipar o que realmente sai
        const initial: Record<string, number> = {};
        for (const it of d.items) initial[it.id] = 0;
        setQty(initial);
      })
      .catch(() => setError("Falha ao carregar"));
  }, [id]);

  function handleScan(r: {
    orderItemId: string;
    qty: number;
    itemName: string;
    unit: string;
    kind: string;
    code: string;
  }) {
    setQty((q) => {
      const item = items?.find((i) => i.id === r.orderItemId);
      const max = item?.qtyPlanned ?? Infinity;
      const next = Math.min(max, (q[r.orderItemId] ?? 0) + r.qty);
      return { ...q, [r.orderItemId]: next };
    });
    setScanCount((n) => n + 1);
    toast(`+${r.qty} ${r.unit} · ${r.itemName}`);
  }

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/pedidos/${id}/saida`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: items!.map((it) => ({
            orderItemId: it.id,
            qtyDelivered: Number(qty[it.id] ?? 0),
          })),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Falha");
      toast("Saída confirmada");
      setTimeout(() => router.push(`/pedidos/${id}`), 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  if (!items && !error) return <Spinner label="Carregando…" />;
  if (error && !items) {
    return <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Conferência de saída</h1>
        <p className="text-sm text-slate-500">
          Bipagem automática ou digitação manual. A devolução será conferida sobre estas quantidades.
        </p>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <Scanner orderId={id} context="saida" onScan={handleScan} disabled={saving} />
      {scanCount > 0 && (
        <p className="text-center text-xs font-semibold text-slate-500">
          {scanCount} bipagem(ns) nesta sessão — ajuste manual se preciso
        </p>
      )}

      <div className="space-y-3">
        {items!.map((it) => {
          const current = qty[it.id] ?? 0;
          const ok = current === it.qtyPlanned;
          const short = current < it.qtyPlanned;
          return (
            <Card key={it.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{it.name}</p>
                <p className="text-sm text-slate-500">
                  Previsto: {it.qtyPlanned} {it.unit}
                  {current > 0 && (
                    <>
                      {" · "}
                      <span
                        className={
                          ok ? "font-bold text-emerald-700" : "font-bold text-amber-700"
                        }
                      >
                        bipado {current}
                      </span>
                      {short && (
                        <span className="text-red-600"> (−{it.qtyPlanned - current})</span>
                      )}
                    </>
                  )}
                </p>
              </div>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={it.qtyPlanned}
                value={current}
                onChange={(e) =>
                  setQty((q) => ({
                    ...q,
                    [it.id]: Math.min(it.qtyPlanned, Math.max(0, Number(e.target.value))),
                  }))
                }
                className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-center text-base font-bold"
              />
            </Card>
          );
        })}
      </div>

      <Button onClick={confirm} disabled={saving}>
        {saving ? "Salvando…" : "Confirmar saída"}
      </Button>
      {el}
    </div>
  );
}
