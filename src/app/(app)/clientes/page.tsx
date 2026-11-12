"use client";

import { useEffect, useState } from "react";
import { Card, Button, Input, useToast, Spinner, EmptyState } from "@/components/ui";

type Customer = { id: string; name: string; phone: string };

export default function ClientesPage() {
  const { toast, el } = useToast();
  const [list, setList] = useState<Customer[] | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch("/api/clientes")
      .then((r) => r.json())
      .then((d) => setList(d.customers))
      .catch(() => setError("Falha ao carregar"));
  };
  useEffect(load, []);

  async function add() {
    setSaving(true);
    setError(null);
    try {
      if (!name.trim()) throw new Error("Nome é obrigatório");
      const res = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast("Cliente adicionado");
      setName("");
      setPhone("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Clientes</h1>
      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <Card className="space-y-3">
        <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} placeholder="Casa Bella Eventos" />
        <Input label="Telefone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(71) 99999-0000" />
        <Button onClick={add} disabled={saving}>
          {saving ? "Salvando…" : "Adicionar"}
        </Button>
      </Card>

      {!list && <Spinner />}
      {list && list.length === 0 && <EmptyState title="Nenhum cliente" />}
      {list && list.length > 0 && (
        <ul className="space-y-2">
          {list.map((c) => (
            <li key={c.id}>
              <Card>
                <p className="font-semibold">{c.name}</p>
                {c.phone && <p className="text-sm text-slate-500">{c.phone}</p>}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {el}
    </div>
  );
}
