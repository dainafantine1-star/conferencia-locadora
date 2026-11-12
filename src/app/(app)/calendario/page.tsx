"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Spinner, Badge } from "@/components/ui";
import Calendar, { type CalendarEvent } from "@/components/Calendar";

type MetricsCalendar = CalendarEvent[];

export default function CalendarioPage() {
  const router = useRouter();
  const [events, setEvents] = useState<MetricsCalendar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"mes" | "lista">("mes");

  useEffect(() => {
    fetch("/api/metricas")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Falha ao carregar"))))
      .then((d) => setEvents(d.calendar))
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return <div className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>;
  }
  if (!events) return <Spinner label="Carregando agenda…" />;

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = [...events]
    .filter((e) => e.due >= today)
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 30);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Agenda</h1>
          <p className="text-sm text-slate-500">
            Eventos (azul) e devoluções previstas (âmbar)
          </p>
        </div>
        <div className="flex overflow-hidden rounded-xl border border-slate-300 bg-white text-xs font-bold">
          <button
            type="button"
            onClick={() => setView("mes")}
            className={`px-3 py-2 ${view === "mes" ? "bg-[#131210] text-white" : "text-slate-600"}`}
          >
            Mês
          </button>
          <button
            type="button"
            onClick={() => setView("lista")}
            className={`px-3 py-2 ${view === "lista" ? "bg-[#131210] text-white" : "text-slate-600"}`}
          >
            Lista
          </button>
        </div>
      </div>

      {view === "mes" ? (
        <Card className="!p-3.5">
          <Calendar events={events} onSelect={(e) => router.push(`/pedidos/${e.id}`)} />
        </Card>
      ) : (
        <Card className="!p-2">
          {upcoming.length === 0 ? (
            <p className="p-4 text-center text-sm text-slate-500">Nenhum evento futuro.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((e) => (
                <li key={`${e.id}-${e.due}`}>
                  <button
                    type="button"
                    onClick={() => router.push(`/pedidos/${e.id}`)}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-slate-50"
                  >
                    <div className="w-14 shrink-0 rounded-lg bg-[#f4f8dd] py-1.5 text-center">
                      <p className="text-[10px] font-bold uppercase text-slate-500">
                        {new Date(e.due + "T12:00:00").toLocaleDateString("pt-BR", {
                          month: "short",
                        })}
                      </p>
                      <p className="text-lg font-black leading-none">
                        {Number(e.due.slice(8, 10))}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">
                        #{e.number} {e.title}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {e.customer} · evento {fmt(e.start)} · devolução {fmt(e.due)}
                      </p>
                    </div>
                    <Badge status={e.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function fmt(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}
