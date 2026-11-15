"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Spinner } from "@/components/ui";
import Calendar, { type CalendarEvent } from "@/components/Calendar";
import AgendaAvailability from "@/components/AgendaAvailability";
import { dayAvailability, type Slot } from "@/lib/business/availability";
import { calendarSources, type CalendarDate } from "@/lib/calendar/dates";

type CalendarData = { year: number; month: number; today: string; events: CalendarEvent[]; dates: CalendarDate[]; slots: Slot[] };
export default function CalendarioPage() {
  const [day, setDay] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(new Date()));
  const [period, setPeriod] = useState(() => ({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) }));
  const [data, setData] = useState<CalendarData | null>(null), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  const [view, setView] = useState<"mes" | "lista">("mes");
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => { window.addEventListener("detali-datachanged", refresh); return () => window.removeEventListener("detali-datachanged", refresh); }, [refresh]);
  useEffect(() => {
    const controller = new AbortController(); setError("");
    fetch(`/api/calendario?year=${period.year}&month=${period.month}`, { signal: controller.signal }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Falha ao carregar calendário"); return result as CalendarData; }).then(setData).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [period.year, period.month, revision]);
  const availability = useMemo(() => { const grouped: Record<string, Slot[]> = {}; for (const slot of data?.slots ?? []) (grouped[slot.day] ??= []).push(slot); return Object.fromEntries(Object.entries(grouped).map(([date, entries]) => [date, dayAvailability(entries).status])); }, [data?.slots]);
  const dates = useMemo(() => [...(data?.dates ?? []), ...(data?.slots ?? []).map(slot => ({ id: `slot:${slot.day}:${slot.hour}`, day: slot.day, name: `${slot.hour} · ${slot.booked}/${slot.capacity} reservas`, kind: "horario" as const, detail: "Capacidade da agenda de horários; não representa reserva de produtos." }))], [data]);
  const selectDay = (value: string) => { setDay(value); setPeriod({ year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) }); };
  const changeMonth = (year: number, month: number) => selectDay(`${year}-${String(month).padStart(2, "0")}-01`);
  const ready = data?.year === period.year && data?.month === period.month;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Calendário</h1><p className="mt-1 text-sm text-slate-600">Eventos, devoluções, orçamentos e datas do Brasil, com nomes e cores.</p></div><div className="flex gap-2">{(["mes", "lista"] as const).map(v => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`min-h-11 rounded-xl border px-4 text-sm font-semibold ${view === v ? "bg-ink text-cream" : "bg-white"}`}>{v === "mes" ? "Mês" : "Lista do mês"}</button>)}</div></div>
    <div className="flex flex-wrap items-end justify-between gap-3"><label className="block text-sm font-semibold">Consultar data<input type="date" min="1900-01-01" max="2199-12-31" value={day} onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && e.target.value >= "1900-01-01" && e.target.value <= "2199-12-31") selectDay(e.target.value); }} className="mt-1 block min-h-11 rounded-xl border border-slate-300 bg-white px-3" /></label><Link href="/gestao/feriados" className="inline-flex min-h-11 items-center text-sm font-semibold text-action underline">Adicionar data local ↗</Link></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error} <button type="button" onClick={refresh} className="min-h-11 underline">Tentar novamente</button></p>}
    {!error && !ready && <Spinner label="Carregando calendário…" />}
    {!error && ready && data && <Card><Calendar events={data.events} dates={dates} year={period.year} month={period.month} selectedDay={day} today={data.today} onMonthChange={changeMonth} onDateSelect={selectDay} availability={availability} />{view === "lista" && <section className="mt-5 border-t pt-4"><h2 className="mb-3 font-bold">Todos os eventos do mês</h2>{data.events.length === 0 && <p className="text-sm text-slate-600">Nenhum evento ou orçamento neste mês.</p>}<ul className="space-y-2">{[...data.events].sort((a, b) => a.start.localeCompare(b.start)).map(event => <li key={`${event.kind}:${event.id}`}><Link href={event.href!} className="block rounded-xl border border-slate-200 p-3 hover:border-action"><p className="text-sm font-semibold">{event.kind === "orcamento" ? "Orçamento" : "Evento"} #{event.number} · {event.title}</p><p className="mt-1 text-xs text-slate-600">{event.customer} · evento {event.start.split("-").reverse().join("/")} · devolução {event.due.split("-").reverse().join("/")}</p></Link></li>)}</ul><h3 className="mb-2 mt-4 font-semibold">Datas e horários do mês</h3><ul className="space-y-1 text-sm">{[...dates].sort((a, b) => a.day.localeCompare(b.day)).map(date => <li key={date.id}>{date.day.split("-").reverse().join("/")} · {date.name}</li>)}</ul></section>}</Card>}
    <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><summary className="cursor-pointer font-semibold text-ink">Sobre as datas e suas fontes</summary><p className="mt-3">Calendário brasileiro com feriados nacionais e principais comemorações culturais e comerciais. Datas móveis são calculadas para o ano exibido. Datas locais cadastradas em Gestão → Feriados também aparecem aqui. Pontos facultativos e comemorações não bloqueiam disponibilidade nem fecham a locadora.</p><p className="mt-2">Não existe uma lista única de todas as comemorações locais e profissionais. Acrescente as relevantes para sua cidade e seu negócio. Expedientes especiais do serviço público devem ser consultados na portaria vigente.</p><ul className="mt-2 space-y-2">{calendarSources.map(source => <li key={source.href}><a href={source.href} target="_blank" rel="noreferrer" className="text-action underline">{source.title} ↗</a></li>)}</ul></details>
    <AgendaAvailability key={`${day}:${revision}`} day={day} />
  </div>;
}
