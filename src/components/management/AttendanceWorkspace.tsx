"use client";
import { Attendance } from "./Attendance";
import { useModule, Spinner, type Options } from "./shared";

export function AttendanceWorkspace({ tab }: { tab: string }) {
  const api = useModule<Options>("opcoes");
  return <div className="space-y-5">
    <div><p className="mb-1 text-xs font-bold uppercase tracking-widest text-action">Detali · Relacionamento</p><h1 className="text-2xl font-bold">Atendimento e agentes</h1><p className="mt-1 text-sm text-slate-600">WhatsApp comercial, CRM, agentes e automações em um só lugar.</p></div>
    {api.feedback}{api.data ? <Attendance options={api.data} initialTab={tab} /> : !api.error && <Spinner />}
  </div>;
}
