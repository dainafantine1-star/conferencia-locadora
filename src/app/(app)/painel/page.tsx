"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell, Card, Badge, Spinner, EmptyState, money } from "@/components/ui";
import { ReturnsAreaChart, SimpleBarChart, DonutChart } from "@/components/charts";

type Metrics = {
  today: string;
  kpi: {
    total: number;
    abertos: number;
    encerrados: number;
    atrasados: number;
    hoje: number;
  };
  revenue: { pendente: number; recebida: number; dispensada: number; sugerido: number };
  returnsSeries: { day: string; devolucoes: number; unidades: number }[];
  weeksSeries: { week: string; pedidos: number }[];
  statusSeries: { name: string; value: number }[];
  billingSeries: { name: string; value: number; cents: number }[];
  calendar: {
    id: string;
    number: number;
    title: string;
    customer: string;
    start: string;
    due: string;
    status: string;
    billing: string;
  }[];
  topItems: { name: string; entregues: number; devolvidos: number; avariados: number }[];
};

export default function PainelPage() {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/metricas")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Falha ao carregar"))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>
    );
  }
  if (!data) return <Spinner label="Carregando painel…" />;

  const dueToday = data.calendar.filter((c) => c.due === data.today && c.status === "aberto");
  const nextEvents = data.calendar
    .filter((c) => c.start >= data.today)
    .slice(0, 5);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Painel</h1>
          <p className="text-sm text-slate-500">
            {new Date().toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })}
          </p>
        </div>
        <Link href="/pedidos/novo" className="text-sm font-bold">
          <span className="inline-block rounded-xl bg-[#c3eb57] px-3.5 py-2 text-[#131210] border border-[#a9d344]">
            + Novo pedido
          </span>
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Retornos hoje" value={data.kpi.hoje} accent />
        <Kpi label="Atrasados" value={data.kpi.atrasados} danger={data.kpi.atrasados > 0} />
        <Kpi label="Em aberto" value={data.kpi.abertos} />
        <Kpi label="Cobrança pendente" value={data.billingSeries.find((b) => b.name === "Pendente")?.value ?? 0} />
      </div>

      {/* Valores */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Money label="A receber" cents={data.revenue.pendente} tone="amber" />
        <Money label="Recebido" cents={data.revenue.recebida} tone="green" />
        <Money label="Dispensado" cents={data.revenue.dispensada} tone="slate" />
        <Money label="Sugerido total" cents={data.revenue.sugerido} tone="ink" />
      </div>

      {/* Destaque — próximos eventos (card de acento ref2) */}
      <Card accent>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-black">Próximos eventos</h2>
          <Link href="/calendario" className="text-xs font-bold underline">
            ver agenda
          </Link>
        </div>
        {nextEvents.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhum evento futuro agendado.</p>
        ) : (
          <ul className="space-y-1.5">
            {nextEvents.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/pedidos/${e.id}`}
                  className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2 hover:bg-white"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">
                      {fmt(e.start)} · #{e.number} {e.title}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{e.customer}</span>
                  </span>
                  <Badge status={e.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Gráficos */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 font-black">Devoluções — últimos 30 dias</h2>
          <p className="mb-2 text-xs text-slate-500">Devoluções registradas e unidades conferidas</p>
          <ReturnsAreaChart data={data.returnsSeries} xKey="day" yKey="devolucoes" y2Key="unidades" />
        </Card>
        <Card>
          <h2 className="mb-1 font-black">Pedidos por semana</h2>
          <p className="mb-2 text-xs text-slate-500">Últimas 8 semanas</p>
          <SimpleBarChart data={data.weeksSeries} xKey="week" yKey="pedidos" color="#131210" />
        </Card>
        <Card>
          <h2 className="mb-1 font-black">Situação dos pedidos</h2>
          <DonutChart
            data={
              data.statusSeries.length > 0
                ? data.statusSeries
                : [{ name: "Sem dados", value: 1 }]
            }
          />
        </Card>
        <Card>
          <h2 className="mb-1 font-black">Cobranças</h2>
          <DonutChart
            data={
              data.billingSeries.length > 0
                ? data.billingSeries
                : [{ name: "Sem dados", value: 1 }]
            }
          />
        </Card>
      </div>

      {/* Itens mais movimentados */}
      <Card>
        <h2 className="mb-3 font-black">Itens mais movimentados</h2>
        {data.topItems.length === 0 ? (
          <EmptyState title="Sem movimentação" />
        ) : (
          <ul className="space-y-2">
            {data.topItems.map((it) => {
              const pct =
                it.entregues > 0 ? Math.round((it.devolvidos / it.entregues) * 100) : 0;
              return (
                <li key={it.name}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-semibold">{it.name}</span>
                    <span className="text-xs text-slate-500">
                      {it.devolvidos}/{it.entregues} devolvidos
                      {it.avariados > 0 && (
                        <span className="ml-1 font-bold text-amber-600">
                          · {it.avariados} avar.
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-[#c3eb57]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Retornos de hoje */}
      <section>
        <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-500">
          Retornos previstos para hoje
        </h2>
        {dueToday.length === 0 ? (
          <EmptyState title="Nada para hoje" hint="Aproveite para organizar o depósito." />
        ) : (
          <ul className="space-y-2">
            {dueToday.map((o) => (
              <li key={o.id}>
                <Link href={`/pedidos/${o.id}`}>
                  <Card className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-bold">
                        #{o.number} · {o.title}
                      </p>
                      <p className="truncate text-sm text-slate-500">{o.customer}</p>
                    </div>
                    <Badge status={o.status} />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
  danger,
}: {
  label: string;
  value: number;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-3.5 ${
        accent
          ? "border-[#a9d344] bg-[#c3eb57] text-[#131210]"
          : danger
            ? "border-red-200 bg-red-50 text-red-800"
            : "border-slate-200 bg-white text-slate-800"
      }`}
    >
      <p className="text-3xl font-black leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-bold uppercase tracking-wide opacity-70">{label}</p>
    </div>
  );
}

function Money({
  label,
  cents,
  tone,
}: {
  label: string;
  cents: number;
  tone: "amber" | "green" | "slate" | "ink";
}) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
    slate: "border-slate-200 bg-white text-slate-600",
    ink: "border-[#131210] bg-[#131210] text-white",
  };
  return (
    <div className={`rounded-2xl border p-3.5 ${tones[tone]}`}>
      <p className="text-lg font-black leading-tight">{money(cents)}</p>
      <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide opacity-70">{label}</p>
    </div>
  );
}

function fmt(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}
