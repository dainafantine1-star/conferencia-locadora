"use client";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { request } from "@/components/management/shared";
import type { HelpArticle } from "@/lib/assistant/types";

type Message = { id: string; role: string; content: string; status: string; metadata: { engine?: string; links?: { title: string; href: string }[] } };
type Action = { id: string; kind: string; title: string; status: string; error: string | null; expiresAt: string; payload: Record<string, unknown>; result?: Record<string, unknown> };
type State = { thread: { id: string } | null; messages: Message[]; actions: Action[]; articles?: HelpArticle[]; aiReady?: boolean };
export function AssistantWidget({ identity }: { identity: string }) {
  const [open, setOpen] = useState(false), [data, setData] = useState<State>({ thread: null, messages: [], actions: [] });
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pathname = usePathname(); const inputRef = useRef<HTMLTextAreaElement>(null); const launcher = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLDivElement>(null); const pending = useRef<{ text: string; key: string } | null>(null);
  const storageKey = `detali-assistant:${identity}`;
  const reload = useCallback(async () => {
    const id = sessionStorage.getItem(storageKey);
    try { setData(await request<State>(`/api/assistente${id ? `?threadId=${encodeURIComponent(id)}` : ""}`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao carregar conversa"); }
  }, [storageKey]);
  useEffect(() => { if (open) { void reload(); inputRef.current?.focus(); } }, [open, reload]);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: "nearest" }); }, [data.messages.length, data.actions.length, open]);
  function close() { setOpen(false); launcher.current?.focus(); }
  async function send(message = text) {
    if (!message.trim() || busy) return; setBusy(true); setError("");
    if (pending.current?.text !== message) pending.current = { text: message, key: crypto.randomUUID() };
    try {
      const result = await request<State>("/api/assistente", { text: message, page: pathname, requestKey: pending.current.key, ...(data.thread ? { threadId: data.thread.id } : {}) });
      setData(previous => ({ ...previous, ...result })); if (result.thread) sessionStorage.setItem(storageKey, result.thread.id);
      setText(""); pending.current = null;
      window.dispatchEvent(new Event("detali-datachanged"));
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível enviar"); }
    finally { setBusy(false); inputRef.current?.focus(); }
  }
  async function confirm(id: string, confirmed: boolean) {
    setBusy(true); setError("");
    try { await request("/api/assistente", { action: "confirm", id, confirm: confirmed }); await reload(); window.dispatchEvent(new Event("detali-datachanged")); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha na operação"); await reload(); }
    finally { setBusy(false); }
  }
  return <>
    {!open && <button ref={launcher} type="button" aria-label="Abrir assistente Detali" aria-expanded={open} aria-controls="detali-assistant" onClick={() => setOpen(true)} className="fixed bottom-24 right-4 z-40 flex h-16 w-16 items-center justify-center rounded-full border border-brand/35 bg-cream shadow-xl ring-4 ring-white transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-action md:bottom-6 md:right-6">
      <Image src="/brand/detali-symbol.svg" alt="" width={32} height={43} />
    </button>}
    {open && <section id="detali-assistant" role="dialog" aria-modal="false" aria-labelledby="assistant-title" onKeyDown={e => { if (e.key === "Escape") close(); }} className="fixed bottom-20 right-2 z-50 flex max-h-[calc(100dvh-6rem)] w-[min(420px,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl md:bottom-6 md:right-6 md:max-h-[min(720px,calc(100dvh-3rem))]">
      <header className="flex shrink-0 items-center justify-between gap-2 bg-ink px-4 py-3 text-white"><Image src="/brand/detali-symbol.svg" alt="" width={24} height={32} /><div className="flex-1"><h2 id="assistant-title" className="font-bold">Assistente Detali</h2><p className="text-xs text-white/75">{data.aiReady ? "Consultas e comandos · sem exclusões" : "Guia local · IA aguardando configuração"}</p></div><button type="button" aria-label="Fechar assistente" onClick={close} className="h-11 w-11 rounded-lg text-2xl hover:bg-white/10">×</button></header>
      <div className="min-h-32 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" aria-relevant="additions text">
        {data.messages.length === 0 && <><p className="text-sm text-slate-700">{data.aiReady ? "Posso cadastrar clientes, criar orçamentos e executar comandos com as suas permissões. Diga o que deseja e informe os dados. Não apago registros." : "Posso orientar por aqui. Para executar pedidos em linguagem natural, configure a IA em Atendimento e agentes → Conexões e IA."}</p><div className="flex flex-wrap gap-2">{["Quais comandos você pode executar?", "Quero cadastrar um cliente", "Onde imprimo QR Codes?"].map(q => <button key={q} type="button" disabled={busy} onClick={() => void send(q)} className="rounded-xl border border-slate-200 bg-cream px-3 py-2 text-left text-sm">{q}</button>)}</div></>}
        {data.messages.map(m => <div key={m.id} className={`rounded-xl p-3 text-sm ${m.role === "user" ? "ml-6 bg-orange-50" : "mr-3 bg-slate-50"}`}><p className="mb-1 text-xs font-semibold text-slate-500">{m.role === "user" ? "Você" : m.metadata.engine === "guia_local" ? "Guia da Detali" : m.status === "falhou" ? "Pendência" : "Assistente"}</p><p className="whitespace-pre-wrap break-words">{m.content}</p>{m.metadata.links?.map(l => <Link key={l.href} href={l.href} onClick={close} className="mt-2 block min-h-9 py-1 font-semibold text-action underline">Abrir: {l.title} ↗</Link>)}</div>)}
        {data.actions.map(a => <div key={a.id} className="rounded-xl border border-action/30 bg-orange-50 p-3 text-sm"><p className="font-semibold">{a.title}</p><ActionPreview action={a} /><p className="mt-2 text-xs">Situação: {a.status}{a.status === "pendente" ? " · aguardando sua confirmação" : ""}</p>{a.error && <p className="mt-1 text-red-800">{a.error}</p>}{a.status === "pendente" && <div className="mt-3 flex gap-2"><button disabled={busy} type="button" onClick={() => void confirm(a.id, true)} className="min-h-11 flex-1 rounded-xl bg-action px-3 font-semibold text-white">Confirmar ação</button><button disabled={busy} type="button" onClick={() => void confirm(a.id, false)} className="min-h-11 rounded-xl border border-slate-300 px-3">Cancelar</button></div>}</div>)}
        {busy && <p role="status" className="text-sm text-slate-600">Processando…</p>}<div ref={endRef} />
      </div>
      {error && <p role="alert" className="px-4 py-2 text-sm text-red-800">{error}</p>}
      <form className="shrink-0 space-y-2 border-t border-slate-200 p-3" onSubmit={e => { e.preventDefault(); void send(); }}>
        <label className="sr-only" htmlFor="assistant-message">Sua mensagem para o assistente</label><textarea ref={inputRef} id="assistant-message" rows={2} value={text} maxLength={3000} disabled={busy} onChange={e => setText(e.target.value)} placeholder="Peça uma ação ou tire uma dúvida…" className="w-full resize-none rounded-xl border border-slate-300 p-3 text-base" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <div className="flex items-center justify-between gap-3"><button type="button" disabled={busy} onClick={() => { sessionStorage.removeItem(storageKey); pending.current = null; setData({ thread: null, messages: [], actions: [], aiReady: data.aiReady }); setError(""); }} className="min-h-11 text-xs font-semibold text-slate-600 underline">Nova conversa</button><button type="submit" disabled={busy || !text.trim()} className="min-h-11 rounded-xl bg-action px-5 text-sm font-semibold text-white disabled:opacity-50">Enviar</button></div>
      </form>
    </section>}
  </>;
}
function ActionPreview({ action }: { action: Action }) {
  if (action.kind === "system_command") return <CommandPreview action={action} />;
  const p = action.payload;
  const fields = [["name", "Nome"], ["email", "E-mail"], ["phone", "Telefone"], ["taxId", "Documento"], ["address", "Endereço"], ["eventName", "Evento"], ["eventDate", "Data do evento"], ["returnDueDate", "Devolução"], ["channel", "Canal"]];
  const lines = Array.isArray(p.lines) ? p.lines as { name: string; qty: number; priceCents: number }[] : [];
  return <div className="mt-2 space-y-1 text-xs text-slate-700">{fields.map(([key, label]) => typeof p[key] === "string" && p[key] ? <p key={key}>{label}: {String(p[key])}</p> : null)}{lines.map((l, i) => <p key={i}>{l.qty} × {l.name} · {(l.priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} cada</p>)}</div>;
}
function CommandPreview({ action }: { action: Action }) {
  const input = action.payload.input as Record<string, unknown> | undefined;
  const fieldLabels: Record<string, string> = { name: "Nome", phone: "Telefone", email: "E-mail", taxId: "CPF/CNPJ", address: "Endereço", eventName: "Evento", start: "Início", end: "Devolução", amountCents: "Valor", dueDate: "Vencimento", method: "Meio", description: "Descrição", direction: "Direção", day: "Data", title: "Título", scheduledAt: "Data e hora", text: "Mensagem", status: "Situação", notes: "Observações", entryId: "Conta", customerId: "Cliente", id: "Registro", threadId: "Conversa", quantity: "Quantidade", kind: "Tipo", reason: "Motivo", installments: "Parcelas", lines: "Itens", mode: "Modo", active: "Ativo", trigger: "Gatilho", keyword: "Palavra-chave", delayMinutes: "Espera em minutos", action: "Ação", published: "Publicado", content: "Conteúdo", instructions: "Instruções", channel: "Canal", audience: "Público" };
  const format = (value: unknown, key: string): string => key.endsWith("Cents") && typeof value === "number" ? (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : typeof value === "object" ? JSON.stringify(value, null, 2) : typeof value === "boolean" ? value ? "Sim" : "Não" : String(value);
  const record = action.result && Object.values(action.result).find(v => v && typeof v === "object" && !Array.isArray(v)) as Record<string, unknown> | undefined;
  return <div className="mt-2 space-y-1 text-xs text-slate-700">
    {input && Object.entries(input).map(([key, value]) => <p key={key} className="whitespace-pre-wrap break-words"><strong>{fieldLabels[key] ?? key}:</strong> {format(value, key)}</p>)}
    {action.status === "executada" && <p className="mt-2 font-semibold text-emerald-800">Concluído no sistema{typeof record?.name === "string" ? ` · ${record.name}` : typeof record?.number === "number" ? ` · #${record.number}` : ""}.</p>}
  </div>;
}
