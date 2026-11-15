"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, Button, useToast, Spinner } from "@/components/ui";
import Scanner from "@/components/Scanner";

type Balance = {
  orderItemId: string;
  name: string;
  unit: string;
  qtyDelivered: number;
  qtyGood: number;
  qtyDamaged: number;
  qtyOpen: number;
};

export default function RetornoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast, el } = useToast();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [good, setGood] = useState<Record<string, number>>({});
  const [damaged, setDamaged] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const idemKey = useRef<string>(`idem-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const fileRef = useRef<HTMLInputElement>(null);
  const balancesRef = useRef<Balance[] | null>(null);
  balancesRef.current = balances;

  const load = useCallback(async () => {
    const res = await fetch(`/api/pedidos/${id}/retorno`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    setBalances(d.balances);
    const g: Record<string, number> = {};
    const dm: Record<string, number> = {};
    for (const b of d.balances) {
      g[b.orderItemId] = 0;
      dm[b.orderItemId] = 0;
    }
    setGood(g);
    setDamaged(dm);
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  function markAllGood() {
    if (!balances) return;
    const g: Record<string, number> = {};
    const dm: Record<string, number> = {};
    for (const b of balances) {
      g[b.orderItemId] = b.qtyOpen;
      dm[b.orderItemId] = 0;
    }
    setGood(g);
    setDamaged(dm);
  }

  function handleScan(r: {
    orderItemId: string;
    qty: number;
    itemName: string;
    unit: string;
  }) {
    const b = balancesRef.current?.find((x) => x.orderItemId === r.orderItemId);
    if (!b) return;
    setGood((g) => {
      const currentGood = g[r.orderItemId] ?? 0;
      const currentDamaged = damaged[r.orderItemId] ?? 0;
      const open = b.qtyOpen - currentGood - currentDamaged;
      const add = Math.min(open, r.qty);
      if (add <= 0) {
        toast("Saldo em aberto zerado para este item");
        return g;
      }
      return { ...g, [r.orderItemId]: currentGood + add };
    });
    setScanCount((n) => n + 1);
    toast(`+${r.qty} ${r.unit} · ${r.itemName}`);
  }

  async function submit() {
    if (!balances) return;
    const lines = balances
      .map((b) => ({
        orderItemId: b.orderItemId,
        qtyGood: Number(good[b.orderItemId] ?? 0),
        qtyDamaged: Number(damaged[b.orderItemId] ?? 0),
      }))
      .filter((l) => l.qtyGood > 0 || l.qtyDamaged > 0);

    if (lines.length === 0) {
      setError("Informe ao menos uma quantidade devolvida");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/pedidos/${id}/retorno`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines,
          notes,
          idempotencyKey: idemKey.current,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Falha ao salvar");

      const returnId = d.returnId as string;
      for (const file of photos) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("returnId", returnId);
        const fres = await fetch(`/api/pedidos/${id}/fotos`, {
          method: "POST",
          body: fd,
        });
        if (!fres.ok) {
          const fd2 = await fres.json();
          toast(`Foto rejeitada: ${fd2.error ?? "erro"}`);
        }
      }

      toast(d.duplicated ? "Devolução já registrada" : "Devolução salva");
      setTimeout(() => router.push(`/pedidos/${id}`), 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
      idemKey.current = `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    } finally {
      setSaving(false);
    }
  }

  if (!balances && !error) return <Spinner label="Carregando saldo…" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Conferência de retorno</h1>
        <p className="text-sm text-slate-500">
          Bipagem ou digitação por item: quanto saiu, quanto já voltou e quanto falta.
        </p>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <Scanner orderId={id} context="retorno" onScan={handleScan} disabled={saving} />
      {scanCount > 0 && (
        <p className="text-center text-xs font-semibold text-slate-500">
          {scanCount} bipagem(ns) — soma em “bom estado”
        </p>
      )}

      <Button variant="secondary" onClick={markAllGood}>
        Voltou tudo em bom estado
      </Button>

      <div className="space-y-3">
        {balances!.map((b) => {
          const g = good[b.orderItemId] ?? 0;
          const dm = damaged[b.orderItemId] ?? 0;
          const remaining = b.qtyOpen - g - dm;
          return (
            <Card key={b.orderItemId} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{b.name}</p>
                  <p className="text-xs text-slate-500">
                    Saiu {b.qtyDelivered} · já voltou {b.qtyGood + b.qtyDamaged} ·{" "}
                    <strong className={b.qtyOpen > 0 ? "text-red-600" : "text-emerald-700"}>
                      falta {b.qtyOpen}
                    </strong>
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    remaining === 0
                      ? "bg-emerald-100 text-emerald-800"
                      : remaining < b.qtyOpen
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {remaining} para conferir
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm">
                <p><span className="block text-xs text-slate-500">Previsto neste retorno</span><strong className="text-xl">{b.qtyOpen}</strong> {b.unit}</p>
                <p><span className="block text-xs text-slate-500">Recebido agora</span><strong className="text-xl">{g + dm}</strong> {b.unit}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Bom estado</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={b.qtyOpen}
                    value={g}
                    onChange={(e) =>
                      setGood((s) => ({
                        ...s,
                        [b.orderItemId]: Math.max(0, Number(e.target.value)),
                      }))
                    }
                    className="w-full rounded-lg border border-emerald-300 px-3 py-2 text-center font-bold text-emerald-800"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Avariado</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={b.qtyOpen}
                    value={dm}
                    onChange={(e) =>
                      setDamaged((s) => ({
                        ...s,
                        [b.orderItemId]: Math.max(0, Number(e.target.value)),
                      }))
                    }
                    className="w-full rounded-lg border border-amber-300 px-3 py-2 text-center font-bold text-amber-800"
                  />
                </label>
              </div>
              {g + dm > b.qtyOpen && (
                <p role="alert" className="text-xs font-semibold text-red-600">
                  Excede o saldo em aberto ({b.qtyOpen})
                </p>
              )}
              {remaining >= 0 && <p aria-live="polite" className={`rounded-lg px-3 py-2 text-sm font-medium ${remaining === 0 ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
                {remaining === 0 ? "✓ Quantidade conferida. Nenhuma unidade pendente." : `! Ainda faltam ${remaining} ${b.unit} para completar o retorno.`}
                {dm > 0 && ` ${dm} ${b.unit} com avaria.`}
              </p>}
            </Card>
          );
        })}
      </div>

      <Card className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Observações</span>
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: chegou no segundo carro"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Fotos da avaria</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            onChange={(e) => setPhotos(Array.from(e.target.files ?? []))}
            className="block w-full text-sm"
          />
        </label>
        {photos.length > 0 && (
          <p className="text-xs text-slate-500">{photos.length} foto(s) selecionada(s)</p>
        )}
      </Card>

      <Button onClick={submit} disabled={saving}>
        {saving ? "Salvando…" : "Salvar devolução"}
      </Button>
      {el}
    </div>
  );
}
