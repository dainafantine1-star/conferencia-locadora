"use client";
import { useEffect, useState } from "react";
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
export function InstallApp() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
    const handler = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  return <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4"><p className="font-semibold">Detali no celular</p><p className="mt-1 text-sm text-slate-600">Instale o aplicativo web para acessar os mesmos dados e módulos pelo celular. As operações precisam de conexão.</p>{event ? <button className="mt-3 min-h-11 rounded-xl bg-action px-4 py-2 text-sm font-semibold text-white" onClick={async () => { await event.prompt(); const result = await event.userChoice; setMessage(result.outcome === "accepted" ? "Instalação solicitada ao navegador." : "Você pode instalar depois pelo menu do navegador."); setEvent(null); }}>Instalar aplicativo</button> : <p className="mt-2 text-xs text-slate-600">No menu do navegador, escolha “Instalar aplicativo” ou “Adicionar à Tela de Início”. Em produção, use HTTPS.</p>}{message && <p role="status" className="mt-2 text-sm">{message}</p>}</div>;
}
