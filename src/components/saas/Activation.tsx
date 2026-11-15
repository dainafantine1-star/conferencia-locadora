"use client";
import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { Brand } from "@/components/Brand";
import { Input, Button, Card } from "@/components/ui";
import { request } from "@/components/management/shared";
export function Activation({ token }: { token: string }) {
  const [email, setEmail] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { void request<{ email: string }>(`/api/saas/ativar-plataforma/${token}`).then(r => setEmail(r.email)).catch(e => setError(e.message)); }, [token]);
  return <main className="mx-auto max-w-lg space-y-5 p-6 py-12"><Brand width={180} /><h1 className="text-3xl font-bold">Ativar administrador Detali</h1><p>Defina sua senha para administrar planos e empresas. Este link pode ser usado uma única vez.</p><Card><form className="space-y-4" onSubmit={async e => { e.preventDefault(); setError(""); const f = new FormData(e.currentTarget), password = String(f.get("password") ?? ""); if (password !== String(f.get("confirmation") ?? "")) { setError("As senhas devem ser iguais"); return; } setBusy(true); try { await request(`/api/saas/ativar-plataforma/${token}`, { password }); const result = await signIn("credentials", { email, password, redirect: false }); if (result?.error) throw new Error("Conta ativada. Entre pela tela de login."); window.location.assign("/admin-detali"); } catch (e) { setError(e instanceof Error ? e.message : "Falha na ativação"); } finally { setBusy(false); } }}><Input label="E-mail" value={email} readOnly /><Input name="password" label="Sua senha" type="password" minLength={12} maxLength={200} autoComplete="new-password" required /><Input name="confirmation" label="Repita a senha" type="password" minLength={12} maxLength={200} autoComplete="new-password" required />{error && <p role="alert" className="text-red-800">{error}</p>}<Button type="submit" disabled={busy || !email}>{busy ? "Ativando…" : "Ativar conta"}</Button></form></Card></main>;
}
