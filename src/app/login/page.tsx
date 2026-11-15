"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button, Input, Card } from "@/components/ui";
import { Brand } from "@/components/Brand";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("E-mail ou senha inválidos");
      return;
    }
    router.push("/painel");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream p-4 sm:p-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_16px_60px_rgb(37_27_35/8%)] md:grid-cols-2">
        <section className="detali-login-art relative hidden flex-col justify-between overflow-hidden p-12 text-cream md:flex" aria-label="Detali, gestão de locações para eventos">
          <Brand light width={224} />
          <div className="relative my-16">
            <p className="mb-5 text-sm font-medium text-brand-soft">Gestão de locações para eventos</p>
            <h2 className="max-w-xs text-6xl font-bold leading-[1.05] tracking-tight">Cada peça<br />conta.</h2>
            <p className="mt-6 max-w-xs text-base leading-relaxed text-cream/85">Do primeiro pedido à última devolução, cuide de cada detalhe.</p>
          </div>
          <p className="relative text-xs text-cream/85">Reservas · Estoque · Devoluções</p>
        </section>
        <section className="min-w-0 px-6 py-8 sm:p-10 md:px-10 md:py-12">
          <div className="mb-8 md:hidden"><Brand width={180} /><p className="mt-2 text-sm text-slate-500">Cada peça conta.</p></div>
          <div className="mb-6">
            <h1 className="text-[28px] font-bold leading-tight">Bem-vindo à Detali</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">Acesse sua conta para acompanhar as locações e conferir seus materiais.</p>
          </div>
      <Card className="!border-0 !p-0 !shadow-none">
        <form onSubmit={onSubmit} className="space-y-4">
          <Input
            label="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="voce@locadora.com"
          />
          <Input
            label="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="••••••••"
          />
          {error && (
            <p
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
              role="alert"
            >
              {error}
            </p>
          )}
          <Button type="submit" disabled={loading}>
            {loading ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </Card>
      <Link href="/cadastro" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-action underline">Criar conta da minha empresa</Link>
      {process.env.NEXT_PUBLIC_DEMO_MODE === "1" && <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
        <p className="mb-1 font-black text-slate-800">Acesso de demonstração</p>
        <p>E-mail: gestor@louca.demo</p>
        <p>Senha: demo1234</p>
      </div>}
        </section>
      </div>
    </main>
  );
}
