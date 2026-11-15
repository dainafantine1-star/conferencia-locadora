"use client";

import { useEffect, useState } from "react";
import { Card, Button, Input } from "@/components/ui";
import { dayAvailability, type Slot } from "@/lib/business/availability";

type Data = {
  slots: Slot[];
  canManage: boolean;
  items: { id: string; name: string; unit: string; stockQty: number | null; reserved: number; available: number | null }[];
};

export default function AgendaAvailability({ day, onSlots }: { day: string; onSlots?: (slots: Slot[]) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [hour, setHour] = useState("14:00");
  const [capacity, setCapacity] = useState("1");
  const [booked, setBooked] = useState("0");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    setNotice("");
    fetch(`/api/agenda?day=${day}`, { signal: controller.signal })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d as Data; })
      .then((d) => { setData(d); onSlots?.(d.slots); })
      .catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [day, revision, onSlots]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/agenda", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ day, hour, capacity: Number(capacity), booked: Number(booked) }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setRevision((v) => v + 1);
      window.dispatchEvent(new Event("detali-datachanged"));
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao salvar"); }
    finally { setSaving(false); }
  }

  const slots = data?.slots.filter((s) => s.day === day) ?? [];
  const summary = dayAvailability(slots);
  const text = `Agenda ${day.split("-").reverse().join("/")}: ${summary.status}.\n${slots.filter((s) => s.capacity > s.booked).map((s) => `${s.hour}: ${s.capacity - s.booked} vaga(s)`).join("\n")}\nItens disponíveis (previsão):\n${data?.items.filter((i) => i.available !== null && i.available > 0).map((i) => `${i.name}: ${i.available} ${i.unit}`).join("\n") || "Nenhum item com disponibilidade informada."}`;

  return <Card className="space-y-4">
    <h2 className="font-bold">Disponibilidade em {day.split("-").reverse().join("/")}</h2>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!data && !error && <p role="status">Consultando disponibilidade…</p>}
    {data && <>
      <p className={`rounded-lg p-3 text-sm font-bold ${summary.status === "aberta" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
        Agenda {summary.status}{summary.remaining > 0 ? ` · ${summary.remaining} vaga(s)` : ""}
      </p>
      {slots.length === 0 && <p className="text-sm text-slate-500">Cadastre os horários deste dia para informar vagas.</p>}
      <ul className="space-y-2">{slots.map((s) => <li key={s.hour} className="flex items-center justify-between rounded-lg bg-slate-50 p-2 text-sm">
        <span><strong>{s.hour}</strong> · {s.capacity - s.booked} vaga(s) · {s.booked}/{s.capacity} reservadas</span>
        {data.canManage && <button type="button" className="px-2 py-1 font-semibold underline" onClick={() => { setHour(s.hour); setCapacity(String(s.capacity)); setBooked(String(s.booked)); }}>Editar</button>}
      </li>)}</ul>
      {data.canManage && <form onSubmit={save} className="space-y-3 border-t border-slate-200 pt-3">
        <h3 className="text-sm font-semibold">Cadastrar ou atualizar horário</h3>
        <p className="text-xs text-slate-500">Controle manual de vagas. Os pedidos aparecem no calendário e não alteram estes números automaticamente. Capacidade zero bloqueia o horário.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Horário" type="time" required value={hour} onChange={(e) => setHour(e.target.value)} />
          <Input label="Capacidade" type="number" min={0} max={10000} required value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          <Input label="Reservadas" type="number" min={0} max={capacity} required value={booked} onChange={(e) => setBooked(e.target.value)} />
        </div>
        <Button type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar horário"}</Button>
      </form>}
      <div className="space-y-2 border-t border-slate-200 pt-3">
        <h3 className="font-semibold">Itens disponíveis na data</h3>
        <p className="text-xs text-slate-500">Disponibilidade calculada com reservas do período, devoluções parciais, atrasos e unidades indisponíveis. Rascunhos também reservam. Consulte vários dias em Gestão → Estoque.</p>
        {data.items.length === 0 && <p className="text-sm">Nenhum item ativo cadastrado.</p>}
        <ul className="divide-y divide-slate-100">{data.items.map((i) => <li key={i.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
          <span>{i.name}<span className="block text-xs text-slate-500">{i.reserved} {i.unit} em pedidos</span></span>
          <strong>{i.available === null ? "Estoque não informado" : `${i.available} ${i.unit} disponíveis`}</strong>
        </li>)}</ul>
      </div>
      <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(text); setNotice("Resumo copiado"); } catch { setError("Não foi possível copiar o resumo"); } }}>Copiar disponibilidade</Button>
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    </>}
  </Card>;
}
