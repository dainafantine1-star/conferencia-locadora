"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import { Card, Button, Input, Select, Spinner } from "@/components/ui";
import type { SessionUser } from "@/lib/auth/session";
import type { CatalogItem, Customer } from "@/lib/db/schema";
export { Card, Button, Input, Select, Spinner };
export type Options = { customers: Customer[]; products: CatalogItem[]; team: { id: string; name: string }[];
  orders: { id: string; number: number; eventName: string; status: string }[]; role: SessionUser["role"]; permissions: string[]; timezone: string };
export async function request<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, body === undefined ? { cache: "no-store" } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Falha na operação (${res.status})`);
  return data;
}
export function useModule<T>(module: string, query = "", base = "/api/gestao") {
  const pendingKeys = useRef(new Map<string, string>());
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const reload = useCallback(async () => { setError(""); try { setData(await request<T>(`${base}/${module}${query}`)); } catch (e) { setError(e instanceof Error ? e.message : "Falha ao carregar"); } }, [module, query, base]);
  useEffect(() => {
    void reload();
    const refresh = () => void reload();
    window.addEventListener("detali-datachanged", refresh);
    return () => window.removeEventListener("detali-datachanged", refresh);
  }, [reload]);
  async function run<R = Record<string, unknown>>(body: unknown, success = "Operação registrada", url = `${base}/${module}`, method = "POST") {
    let fingerprint: string | undefined;
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      const field = "idempotencyKey" in record ? "idempotencyKey" : "requestKey" in record ? "requestKey" : undefined;
      if (field) { fingerprint = url + JSON.stringify({ ...record, [field]: undefined }); const key = pendingKeys.current.get(fingerprint) ?? String(record[field]); pendingKeys.current.set(fingerprint, key); body = { ...record, [field]: key }; }
    }
    setBusy(true); setError(""); setMessage("");
    try { const result = await request<R>(url, body, method); if (fingerprint) pendingKeys.current.delete(fingerprint); setMessage(success); await reload(); window.dispatchEvent(new Event("detali-datachanged")); return result; }
    catch (e) { setError(e instanceof Error ? e.message : "Falha na operação"); return null; }
    finally { setBusy(false); }
  }
  const feedback = <>{error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}</>;
  return { data, reload, run, busy, feedback, error };
}
export function Form({ children, onSubmit, busy, label = "Salvar" }: { children: React.ReactNode; onSubmit: (data: FormData) => Promise<unknown>; busy: boolean; label?: string }) {
  const [error, setError] = useState("");
  return <form className="space-y-3" onSubmit={async e => { e.preventDefault(); setError(""); try { await onSubmit(new FormData(e.currentTarget)); } catch (e) { setError(e instanceof Error ? e.message : "Confira os campos"); } }}>
    <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2">{children}</fieldset>{error && <p role="alert" className="text-sm text-red-800">{error}</p>}<Button type="submit" disabled={busy}>{busy ? "Registrando…" : label}</Button>
  </form>;
}
export function Area({ label, ...props }: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <label className="block sm:col-span-2"><span className="mb-1 block text-[13px] font-semibold text-slate-600">{label}</span><textarea {...props} className="min-h-24 w-full rounded-xl border border-slate-300 bg-white p-3 text-base" /></label>;
}
export function Check({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label className="flex min-h-11 items-center gap-2 text-sm"><input {...props} type="checkbox" className="h-5 w-5 accent-action" />{label}</label>;
}
export function Disclosure({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return <Card><details open={open}><summary className="min-h-11 cursor-pointer py-2 font-semibold">{title}</summary><div className="mt-3">{children}</div></details></Card>;
}
export const value = (f: FormData, key: string) => String(f.get(key) ?? "").trim();
export const nullable = (f: FormData, key: string) => value(f, key) || null;
export function toCents(raw: string) { const v = raw.replace(/\s/g, "").replace(",", "."); if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new Error("Informe um valor com até duas casas decimais"); return Math.round(Number(v) * 100); }
export const amount = (f: FormData, key: string) => toCents(value(f, key) || "0");
export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(new Date());
export const dateLabel = (v: string | Date) => typeof v === "string" && v.length === 10 ? v.split("-").reverse().join("/") : new Date(v).toLocaleString("pt-BR");
export function List({ empty, children, count }: { empty: string; children: React.ReactNode; count: number }) { return count ? <div className="space-y-3">{children}</div> : <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">{empty}</p>; }
export function Actions({ children }: { children: React.ReactNode }) { return <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>; }
export function Download({ href, children }: { href: string; children: React.ReactNode }) { return <a href={href} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-center text-sm font-semibold">{children}</a>; }
export function MoneyField({ label, name, defaultValue, required = true }: { label: string; name: string; defaultValue?: string | number; required?: boolean }) { return <Input name={name} label={label} inputMode="decimal" defaultValue={defaultValue} placeholder="0,00" required={required} pattern="[0-9]+([.,][0-9]{1,2})?" />; }
