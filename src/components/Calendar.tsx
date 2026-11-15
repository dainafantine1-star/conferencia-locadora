"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { CalendarDate } from "@/lib/calendar/dates";

export type CalendarEvent = { id: string; number: number; title: string; customer: string; start: string; due: string; status: string; billing: string; kind?: "evento" | "orcamento"; href?: string };
type Entry = { id: string; title: string; type: string; detail: string; href?: string; source?: string };
const styles: Record<string, string> = { evento: "border-orange-500 bg-orange-100 text-orange-950", devolucao: "border-amber-500 bg-amber-100 text-amber-950", orcamento: "border-violet-500 bg-violet-100 text-violet-950", feriado: "border-rose-500 bg-rose-100 text-rose-950", comemorativa: "border-teal-600 bg-teal-50 text-teal-950", facultativo: "border-slate-500 bg-slate-100 text-slate-800", local: "border-rose-400 bg-rose-50 text-rose-950", horario: "border-sky-500 bg-sky-100 text-sky-950" };
const labels: Record<string, string> = { evento: "Evento", devolucao: "Devolução", orcamento: "Orçamento", feriado: "Feriado nacional", comemorativa: "Comemoração", facultativo: "Referência facultativa", local: "Data local / religiosa", horario: "Agenda de horários" };
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
export default function Calendar({ events, dates = [], onDateSelect, availability = {}, year, month, selectedDay, onMonthChange, today }: {
  events: CalendarEvent[]; dates?: CalendarDate[]; onDateSelect: (day: string) => void; availability?: Record<string, string>;
  year: number; month: number; selectedDay: string; onMonthChange: (year: number, month: number) => void; today: string;
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const entries = useMemo(() => {
    const map = new Map<string, Entry[]>();
    const add = (day: string, item: Entry) => map.set(day, [...(map.get(day) ?? []), item]);
    for (const event of events) {
      const type = event.kind ?? "evento";
      add(event.start, { id: `${type}:${event.id}`, title: `${type === "orcamento" ? "Orç. " : ""}#${event.number} ${event.title}`, type, detail: `${event.customer} · ${event.status}`, href: event.href ?? `/pedidos/${event.id}` });
      if (type === "evento" && event.status !== "encerrado") add(event.due, { id: `due:${event.id}`, title: `Devolução · ${event.title}`, type: "devolucao", detail: `#${event.number} · ${event.customer}`, href: event.href ?? `/pedidos/${event.id}` });
    }
    for (const date of dates) add(date.day, { id: date.id, title: date.name, type: date.kind, detail: date.detail ?? labels[date.kind], source: date.source });
    return map;
  }, [events, dates]);
  const visible = (day: string) => (entries.get(day) ?? []).filter(e => !hidden.includes(e.type));
  const dayEntries = visible(selectedDay);
  const first = new Date(year, month - 1, 1).getDay(), total = new Date(year, month, 0).getDate();
  const monthName = new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const move = (delta: number) => { const date = new Date(year, month - 1 + delta, 1); if (date.getFullYear() >= 1900 && date.getFullYear() <= 2199) onMonthChange(date.getFullYear(), date.getMonth() + 1); };
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-2"><button type="button" aria-label="Mês anterior" onClick={() => move(-1)} className="min-h-11 min-w-11 rounded-xl border border-slate-200 text-xl">‹</button><h2 aria-live="polite" className="font-bold capitalize text-ink">{monthName}</h2><button type="button" onClick={() => { onMonthChange(Number(today.slice(0, 4)), Number(today.slice(5, 7))); onDateSelect(today); }} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm">Hoje</button><button type="button" aria-label="Próximo mês" onClick={() => move(1)} className="min-h-11 min-w-11 rounded-xl border border-slate-200 text-xl">›</button></div>
    <fieldset className="flex flex-wrap gap-x-3 gap-y-1"><legend className="sr-only">Filtrar tipos de compromisso</legend>{Object.entries(labels).map(([key, label]) => <label key={key} className="inline-flex min-h-9 items-center gap-1.5 text-xs text-slate-700"><input type="checkbox" checked={!hidden.includes(key)} onChange={e => setHidden(prev => e.target.checked ? prev.filter(x => x !== key) : [...prev, key])} /><span className={`h-2.5 w-2.5 rounded-full border ${styles[key]}`} />{label}</label>)}</fieldset>
    <div className="overflow-x-auto pb-2"><div className="min-w-[630px]"><div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(w => <div key={w} className="py-2">{w}</div>)}</div><div className="grid grid-cols-7 gap-1">{Array.from({ length: first + total }, (_, index) => {
      if (index < first) return <div key={`blank:${index}`} />;
      const day = index - first + 1, date = iso(year, month, day), items = visible(date);
      return <button key={date} type="button" aria-label={`${day} de ${monthName}: ${items.length} marcações${items.length ? `, ${items.map(e => e.title).join(", ")}` : ""}`} aria-pressed={date === selectedDay} onClick={() => onDateSelect(date)} className={`min-h-32 min-w-0 rounded-xl border p-1.5 text-left transition ${date === selectedDay ? "border-action bg-cream ring-2 ring-action/20" : "border-slate-200 bg-white hover:border-action/50"}`}><span className={`mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold ${date === today ? "bg-action text-white" : "text-ink"}`}>{day}</span>{availability[date] && <span className="ml-1 text-[10px] text-slate-600">{availability[date]}</span>}<span className="block space-y-1">{items.slice(0, 3).map(item => <span key={item.id} title={`${labels[item.type]}: ${item.title}`} className={`block truncate rounded border-l-[3px] px-1 py-1 text-[10px] font-semibold ${styles[item.type]}`}>{item.title}</span>)}{items.length > 3 && <span className="block text-[10px] font-semibold text-action">+{items.length - 3} · ver todos</span>}</span></button>;
    })}</div></div></div>
    <section aria-labelledby="calendar-day-title" className="rounded-xl border border-slate-200 bg-cream/40 p-4"><h3 id="calendar-day-title" className="mb-3 font-semibold">{new Date(`${selectedDay}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h3>{dayEntries.length === 0 ? <p className="text-sm text-slate-600">Nenhuma marcação nas categorias selecionadas.</p> : <ul className="space-y-2">{dayEntries.map(item => <li key={item.id} className={`rounded-xl border-l-4 p-3 ${styles[item.type]}`}><p className="text-[10px] font-bold uppercase">{labels[item.type]}</p>{item.href ? <Link href={item.href} className="block py-1 text-sm font-bold underline">{item.title} ↗</Link> : <p className="py-1 text-sm font-bold">{item.title}</p>}<p className="text-xs">{item.detail}</p>{item.source && <a href={item.source} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-9 items-center text-xs underline">Consultar fonte ↗</a>}</li>)}</ul>}</section>
  </div>;
}
