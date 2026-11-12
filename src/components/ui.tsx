"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "next-auth/react";

export function Card({
  children,
  className = "",
  accent = false,
}: {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-[0_1px_2px_rgba(19,18,16,0.06)] ${
        accent
          ? "surface-accent"
          : "border-slate-200/80 bg-white"
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "ghost" | "accent";
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    primary: "bg-[#131210] text-white hover:bg-black active:opacity-90",
    accent:
      "bg-[#c3eb57] text-[#131210] hover:brightness-95 active:opacity-90 border border-[#a9d344]",
    secondary: "bg-white text-slate-800 hover:bg-slate-50 border border-slate-300",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "text-[#131210] hover:bg-black/5",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[44px] w-full rounded-xl px-4 py-2.5 text-center text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-semibold text-slate-600">{label}</span>
      <input
        {...props}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none transition focus:border-[#c3eb57] focus:ring-2 focus:ring-[#c3eb57]/40"
      />
    </label>
  );
}

export function Select({
  label,
  children,
  ...props
}: { label: string; children: React.ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-semibold text-slate-600">{label}</span>
      <select
        {...props}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none transition focus:border-[#c3eb57] focus:ring-2 focus:ring-[#c3eb57]/40"
      >
        {children}
      </select>
    </label>
  );
}

export function Badge({ status }: { status: string }) {
  const map: Record<string, string> = {
    rascunho: "bg-slate-200 text-slate-700",
    aberto: "bg-[#c3eb57] text-[#131210]",
    encerrado: "bg-[#131210] text-white",
    sem_cobranca: "bg-slate-100 text-slate-500 border border-slate-200",
    pendente: "bg-amber-100 text-amber-900",
    recebida: "bg-emerald-100 text-emerald-900",
    dispensada: "bg-violet-100 text-violet-900",
    gestor: "bg-[#131210] text-white",
    operador: "bg-[#c3eb57] text-[#131210]",
  };
  const labels: Record<string, string> = {
    rascunho: "Rascunho",
    aberto: "Em aberto",
    encerrado: "Encerrado",
    sem_cobranca: "Sem cobrança",
    pendente: "Cobrança pendente",
    recebida: "Recebida",
    dispensada: "Dispensada",
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
        map[status] ?? "bg-slate-100"
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-8 text-center">
      <p className="font-bold text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

export function Spinner({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-6 text-slate-500" role="status">
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[#131210] border-t-transparent" />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  return (
    <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#131210] px-4 py-3 text-sm font-semibold text-white shadow-xl md:bottom-6">
      {message}{" "}
      <button onClick={onDone} className="ml-2 underline opacity-70">
        ok
      </button>
    </div>
  );
}

type NavItem = { href: string; label: string; icon: string };

const NAV: NavItem[] = [
  { href: "/painel", label: "Painel", icon: "▦" },
  { href: "/calendario", label: "Agenda", icon: "☰" },
  { href: "/pedidos", label: "Pedidos", icon: "≣" },
  { href: "/catalogo", label: "Catálogo", icon: "◆" },
  { href: "/clientes", label: "Clientes", icon: "◐" },
  { href: "/equipe", label: "Equipe", icon: "◉" },
];

export function AppShell({
  children,
  role,
}: {
  children: React.ReactNode;
  role?: string;
}) {
  const pathname = usePathname();
  const items = role === "gestor" ? NAV : NAV.filter((n) => n.href !== "/equipe");

  const isActive = (href: string) =>
    pathname === href ||
    pathname.startsWith(href + "/") ||
    (href === "/pedidos" && pathname.startsWith("/pedidos"));

  return (
    <div className="min-h-screen bg-[#eaedf2] md:pl-[216px]">
      {/* Sidebar escura — desktop (ref1) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[216px] flex-col bg-[#0d0d0d] text-[#e8e8e8] md:flex">
        <div className="border-b border-white/10 px-5 py-5">
          <p className="text-lg font-black tracking-tight">
            <span className="bg-[#c3eb57] px-1.5 py-0.5 text-[#0d0d0d]">CONF</span> Locadora
          </p>
          <p className="mt-1 text-[11px] uppercase tracking-wider text-white/40">
            Conferência de material
          </p>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {items.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                  active
                    ? "bg-[#c3eb57] text-[#0d0d0d]"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="w-5 text-center text-base leading-none">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-3 py-4">
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            ← Sair
          </button>
        </div>
      </aside>

      {/* Topo mobile */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
        <Link href="/painel" className="text-base font-black tracking-tight">
          <span className="bg-[#c3eb57] px-1.5 py-0.5 text-[#0d0d0d]">CONF</span> Locadora
        </Link>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-sm font-semibold text-slate-500"
        >
          Sair
        </button>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4 pb-24 md:py-8 md:pb-8">{children}</main>

      {/* Bottom nav mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0d0d0d] md:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-around">
          {items.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition ${
                  active ? "text-[#c3eb57]" : "text-white/55"
                }`}
              >
                <span className="text-lg leading-none">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const toast = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2500);
  };
  const el = msg ? <Toast message={msg} onDone={() => setMsg(null)} /> : null;
  return { toast, el };
}
