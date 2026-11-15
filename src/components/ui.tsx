"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "next-auth/react";
import { Brand } from "@/components/Brand";
import { NavIcon, type NavIconName } from "@/components/NavIcon";

export function Card({ children, className = "", accent = false, id }: {
  children: React.ReactNode; className?: string; accent?: boolean; id?: string;
}) {
  return <div id={id} className={`detali-card min-w-0 rounded-2xl border p-4 ${accent ? "surface-accent" : "border-slate-200/80 bg-white"} ${className}`}>{children}</div>;
}

export function Button({ children, onClick, type = "button", variant = "primary", disabled, className = "" }: {
  children: React.ReactNode; onClick?: () => void; type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "ghost" | "accent";
  disabled?: boolean; className?: string;
}) {
  const styles = {
    primary: "bg-action text-cream hover:bg-action-hover active:opacity-90",
    accent: "border border-action/40 bg-brand text-ink hover:bg-brand-soft active:opacity-90",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "text-ink hover:bg-brand-soft/50",
  };
  return <button type={type} onClick={onClick} disabled={disabled} className={`min-h-[44px] w-full rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}>{children}</button>;
}

export function Input({ label, className = "", ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label className="block min-w-0">
    <span className="mb-1 block text-[13px] font-semibold text-slate-600">{label}</span>
    <input {...props} className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 transition focus:border-action ${className}`} />
  </label>;
}

export function Select({ label, children, className = "", ...props }: { label: string; children: React.ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <label className="block min-w-0">
    <span className="mb-1 block text-[13px] font-semibold text-slate-600">{label}</span>
    <select {...props} aria-label={label} className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 transition focus:border-action ${className}`}>{children}</select>
  </label>;
}

export function Badge({ status }: { status: string }) {
  const map: Record<string, string> = {
    rascunho: "bg-slate-200 text-slate-700", aberto: "bg-brand-soft text-ink", encerrado: "bg-ink text-cream",
    sem_cobranca: "border border-slate-200 bg-slate-100 text-slate-500", pendente: "bg-amber-100 text-amber-900",
    recebida: "bg-emerald-100 text-emerald-900", dispensada: "bg-violet-100 text-violet-900",
    gestor: "bg-ink text-cream", operador: "bg-brand-soft text-ink",
  };
  const labels: Record<string, string> = {
    rascunho: "Rascunho", aberto: "Em aberto", encerrado: "Encerrado", sem_cobranca: "Sem cobrança",
    pendente: "Cobrança pendente", recebida: "Recebida", dispensada: "Dispensada",
  };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${map[status] ?? "bg-slate-100"}`}>{labels[status] ?? status}</span>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-8 text-center">
    <p className="font-semibold text-slate-700">{title}</p>
    {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
  </div>;
}

export function Spinner({ label = "Carregando…" }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 p-6 text-slate-500" role="status">
    <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-action border-t-transparent" />
    <span className="text-sm font-medium">{label}</span>
  </div>;
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  return <div role="status" className="fixed bottom-24 left-1/2 z-50 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-cream shadow-xl md:bottom-6">
    {message}{" "}<button onClick={onDone} aria-label="Fechar mensagem" className="ml-2 min-h-11 min-w-11 underline">ok</button>
  </div>;
}

type NavItem = { href: string; label: string; icon: NavIconName };
const NAV: NavItem[] = [
  { href: "/painel", label: "Painel", icon: "painel" },
  { href: "/calendario", label: "Agenda", icon: "agenda" },
  { href: "/pedidos", label: "Pedidos", icon: "pedidos" },
  { href: "/catalogo", label: "Catálogo", icon: "catalogo" },
  { href: "/atendimento", label: "Atendimento e agentes", icon: "clientes" },
  { href: "/notas-fiscais", label: "Notas fiscais", icon: "pedidos" },
  { href: "/gestao", label: "Gestão", icon: "painel" },
  { href: "/clientes", label: "Clientes", icon: "clientes" },
  { href: "/equipe", label: "Equipe", icon: "equipe" },
];

export function AppShell({ children, role, permissions = [] }: { children: React.ReactNode; role?: string; permissions?: string[] }) {
  const pathname = usePathname();
  const can = (permission: string) => role === "gestor" || permissions.includes(permission);
  const items = NAV.filter(n => (n.href !== "/equipe" || role === "gestor") && (n.href !== "/atendimento" || can("atendimento")) && (n.href !== "/notas-fiscais" || can("fiscal")));
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  return <div className="min-h-screen bg-cream md:pl-[232px]">
    <a href="#conteudo" className="sr-only fixed left-4 top-4 z-50 rounded-xl bg-cream p-3 text-ink focus:not-sr-only">Ir para o conteúdo</a>
    <aside className="detali-sidebar fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col overflow-y-auto bg-ink text-cream md:flex">
      <div className="border-b border-cream/15 px-6 py-7">
        <Link href="/painel" aria-label="Detali — Painel" className="inline-block py-2"><Brand light width={170} /></Link>
        <p className="mt-3 text-xs text-cream/80">Cada peça conta.</p>
      </div>
      <nav aria-label="Navegação principal" className="flex-1 space-y-1.5 px-4 py-6">
        {items.map((item) => {
          const active = isActive(item.href);
          return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-brand text-ink" : "text-cream/80 hover:bg-cream/10 hover:text-cream"}`}>
            <NavIcon name={item.icon} />{item.label}
          </Link>;
        })}
      </nav>
      <div className="mx-4 mb-5 rounded-2xl bg-cream/5 p-4">
        <p className="text-sm font-semibold text-cream">Tudo em seu lugar.</p>
        <p className="mt-1 text-xs leading-relaxed text-cream/75">Reservas, estoque e devoluções.</p>
      </div>
      <div className="border-t border-cream/15 px-4 py-4">
        <p className="mb-2 px-3 text-xs text-cream/75">{role === "gestor" ? "Acesso gestor" : "Acesso operador"}</p>
        <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-cream/80 transition hover:bg-cream/10 hover:text-cream"><NavIcon name="sair" />Sair</button>
      </div>
    </aside>
    <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
      <Link href="/painel" aria-label="Detali — Painel" className="inline-flex min-h-11 items-center"><Brand width={140} /></Link>
      <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="min-h-11 min-w-11 text-sm font-semibold text-slate-600">Sair</button>
    </header>
    <div className="sticky top-[69px] z-30 border-b border-action/15 bg-cream/95 backdrop-blur md:top-0">
      <nav aria-label="Acessos rápidos" className="mx-auto flex max-w-6xl items-center gap-2 overflow-x-auto px-4 py-3 md:px-8">
        {can("atendimento") && <Link href="/atendimento" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-cream"><span aria-hidden="true">◉</span>WhatsApp</Link>}
        <Link href="/calendario" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-action/25 bg-white px-4 text-sm font-semibold text-action"><NavIcon name="agenda" />Calendário</Link>
        {can("comercial") && <Link href="/gestao/comercial" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-action/25 bg-white px-4 text-sm font-semibold text-action"><NavIcon name="pedidos" />Orçamentos</Link>}
        <Link href="/pedidos" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-ink"><NavIcon name="agenda" />Eventos</Link>
        {can("fiscal") && <Link href="/notas-fiscais" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-action/25 bg-white px-4 text-sm font-semibold text-action">NF-e</Link>}
        {role === "gestor" && <Link href="/atendimento/automacoes" className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-action/25 px-3 text-sm font-semibold text-action">Automações WhatsApp ↗</Link>}
      </nav>
    </div>
    <main id="conteudo" tabIndex={-1} className="detali-content mx-auto max-w-6xl px-4 py-5 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-8 md:py-8 md:pb-8">{children}</main>
    <nav aria-label="Navegação principal" className="detali-mobile-nav fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-cream shadow-[0_-4px_20px_rgb(37_27_35/6%)] md:hidden">
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {items.filter(item => !["/clientes", "/equipe", "/calendario", "/notas-fiscais"].includes(item.href)).map((item) => {
          const active = isActive(item.href);
          return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`flex min-h-[64px] min-w-0 flex-1 flex-col items-center justify-center gap-1 border-t-2 text-[10px] font-semibold transition ${active ? "border-action bg-brand-soft/40 text-action" : "border-transparent text-slate-600 hover:bg-brand-soft/30"}`}>
            <NavIcon name={item.icon} />{item.label}
          </Link>;
        })}
      </div>
    </nav>
  </div>;
}

export function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const toast = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2500); };
  const el = msg ? <Toast message={msg} onDone={() => setMsg(null)} /> : null;
  return { toast, el };
}
