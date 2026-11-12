"use client";

import { useMemo, useState } from "react";

export type CalendarEvent = {
  id: string;
  number: number;
  title: string;
  customer: string;
  start: string; // YYYY-MM-DD
  due: string;
  status: string;
  billing: string;
};

type Props = {
  events: CalendarEvent[];
  onSelect?: (e: CalendarEvent) => void;
};

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export default function Calendar({ events, onSelect }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState<string | null>(null);
  const todayISO = toISO(now.getFullYear(), now.getMonth(), now.getDate());

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const list = map.get(e.start) ?? [];
      list.push(e);
      map.set(e.start, list);
      // marca também a previsão de devolução
      const due = map.get(`due:${e.due}`) ?? [];
      map.set(`due:${e.due}`, due);
    }
    return map;
  }, [events]);

  const dueByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const list = map.get(e.due) ?? [];
      list.push(e);
      map.set(e.due, list);
    }
    return map;
  }, [events]);

  const days: (number | null)[] = [];
  const first = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < first; i++) days.push(null);
  for (let d = 1; d <= total; d++) days.push(d);

  const monthName = new Date(year, month, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  function prev() {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  }
  function next() {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  }

  const dayEvents = selected
    ? [
        ...(byDate.get(selected) ?? []),
        ...(selected.startsWith("due:")
          ? []
          : dueByDate.get(selected) ?? []),
      ]
    : [];
  const uniqueDayEvents = Array.from(new Map(dayEvents.map((e) => [e.id, e])).values());

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={prev}
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-slate-600 shadow-sm border border-slate-200"
          aria-label="Mês anterior"
        >
          ‹
        </button>
        <p className="font-bold capitalize text-slate-800">{monthName}</p>
        <button
          type="button"
          onClick={next}
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-slate-600 shadow-sm border border-slate-200"
          aria-label="Próximo mês"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-slate-400">
        {WEEKDAYS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          if (d === null) return <div key={`x${i}`} />;
          const iso = toISO(year, month, d);
          const evs = byDate.get(iso) ?? [];
          const dues = dueByDate.get(iso) ?? [];
          const isToday = iso === todayISO;
          const isSel = selected === iso;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => setSelected(isSel ? null : iso)}
              className={`relative aspect-square rounded-lg border p-0.5 text-left text-xs transition ${
                isSel
                  ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-300"
                  : isToday
                    ? "border-emerald-400 bg-emerald-50"
                    : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <span
                className={`block font-bold ${
                  isToday ? "text-emerald-700" : "text-slate-700"
                }`}
              >
                {d}
              </span>
              <span className="flex gap-0.5">
                {evs.slice(0, 2).map((e) => (
                  <span
                    key={e.id}
                    className="h-1.5 w-1.5 rounded-full bg-blue-500"
                    title={`Evento: ${e.title}`}
                  />
                ))}
                {dues.slice(0, 2).map((e) => (
                  <span
                    key={`d${e.id}`}
                    className="h-1.5 w-1.5 rounded-full bg-amber-500"
                    title={`Devolução: ${e.title}`}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex gap-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-blue-500" /> Evento
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-amber-500" /> Devolução prevista
        </span>
      </div>

      {selected && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="mb-1 text-xs font-bold uppercase text-slate-400">
            {selected.split("-").reverse().join("/")}
          </p>
          {uniqueDayEvents.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum pedido neste dia</p>
          ) : (
            <ul className="space-y-1.5">
              {uniqueDayEvents.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onSelect?.(e)}
                    className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-2 py-1.5 text-left hover:bg-slate-100"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        #{e.number} {e.title}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {e.customer}
                      </span>
                    </span>
                    <span
                      className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        e.status === "encerrado"
                          ? "bg-emerald-100 text-emerald-700"
                          : e.status === "aberto"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {e.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
