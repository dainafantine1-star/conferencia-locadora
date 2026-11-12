"use client";

import { useEffect, useState } from "react";
import { Card, Button, Input, Select, useToast, Spinner, Badge, EmptyState } from "@/components/ui";

type Member = {
  id: string;
  name: string;
  email: string;
  role: "gestor" | "operador";
  active: boolean;
};

export default function EquipePage() {
  const { toast, el } = useToast();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"gestor" | "operador">("operador");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch("/api/equipe")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Sem permissão");
        setMembers(d.members);
      })
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);

  async function add() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/equipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast("Membro adicionado");
      setName("");
      setEmail("");
      setPassword("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  if (error && !members) {
    return <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Equipe</h1>
      <p className="text-sm text-slate-500">
        Apenas gestores administram a equipe. Operadores conferem material e registram pedidos.
      </p>
      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <Card className="space-y-3">
        <h2 className="font-semibold">Novo membro</h2>
        <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input
          label="Senha"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="mínimo 8 caracteres"
        />
        <Select
          label="Perfil"
          value={role}
          onChange={(e) => setRole(e.target.value as "gestor" | "operador")}
        >
          <option value="operador">Operador</option>
          <option value="gestor">Gestor</option>
        </Select>
        <Button onClick={add} disabled={saving}>
          {saving ? "Salvando…" : "Adicionar"}
        </Button>
      </Card>

      {!members && <Spinner />}
      {members && members.length === 0 && <EmptyState title="Nenhum membro" />}
      {members && members.length > 0 && (
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.id}>
              <Card className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{m.name}</p>
                  <p className="text-sm text-slate-500">{m.email}</p>
                </div>
                <Badge status={m.role === "gestor" ? "recebida" : "aberto"} />
              </Card>
            </li>
          ))}
        </ul>
      )}
      {el}
    </div>
  );
}
