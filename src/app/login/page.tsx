"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button, Input, Card } from "@/components/ui";

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
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-[#eaedf2] px-4 py-8">
      <div className="mb-6">
        <p className="inline-block bg-[#0d0d0d] px-2 py-1 text-2xl font-black tracking-tight text-white">
          <span className="bg-[#c3eb57] px-1.5 py-0.5 text-[#0d0d0d]">CONF</span> Locadora
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Conferência de saída e devolução de materiais de festa
        </p>
      </div>
      <Card>
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
          <Button type="submit" variant="accent" disabled={loading}>
            {loading ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </Card>
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
        <p className="mb-1 font-black text-slate-800">Demonstração (senha: demo1234)</p>
        <p>gestor@louca.demo · operador@louca.demo</p>
        <p>gestor@outra.demo · operador@outra.demo</p>
      </div>
    </div>
  );
}
