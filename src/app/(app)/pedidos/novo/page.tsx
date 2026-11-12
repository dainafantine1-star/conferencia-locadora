"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Input, Select, useToast } from "@/components/ui";

type Customer = { id: string; name: string };
type CatalogItem = { id: string; name: string; unit: string };

type Line = {
  key: number;
  catalogItemId: string | "";
  name: string;
  unit: string;
  qtyPlanned: number;
};

export default function NovoPedidoPage() {
  const router = useRouter();
  const { toast, el } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [returnDueDate, setReturnDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { key: 1, catalogItemId: "", name: "", unit: "un", qtyPlanned: 1 },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clientes").then((r) => r.json()).then((d) => setCustomers(d.customers ?? []));
    fetch("/api/catalogo").then((r) => r.json()).then((d) => setCatalog(d.items ?? []));
  }, []);

  function addLine() {
    setLines((ls) => [
      ...ls,
      { key: Date.now(), catalogItemId: "", name: "", unit: "un", qtyPlanned: 1 },
    ]);
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function onCatalogPick(key: number, id: string) {
    const item = catalog.find((c) => c.id === id);
    if (item) {
      updateLine(key, { catalogItemId: id, name: item.name, unit: item.unit });
    } else {
      updateLine(key, { catalogItemId: "", name: "" });
    }
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        customerId,
        eventName,
        eventDate,
        returnDueDate,
        notes,
        items: lines
          .filter((l) => l.name.trim())
          .map((l) => ({
            catalogItemId: l.catalogItemId || null,
            name: l.name.trim(),
            unit: l.unit || "un",
            qtyPlanned: Number(l.qtyPlanned),
          })),
      };
      const res = await fetch("/api/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao salvar");
      toast("Pedido criado");
      setTimeout(() => router.push(`/pedidos/${data.order.id}`), 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Novo pedido</h1>
      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <Card className="space-y-3">
        <Select
          label="Cliente"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          required
        >
          <option value="">Selecione…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input
          label="Evento (nome ou referência)"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          required
          placeholder="Casamento Ana & Pedro"
        />
        <Input
          label="Data do evento"
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          required
        />
        <Input
          label="Previsão de devolução"
          type="date"
          value={returnDueDate}
          onChange={(e) => setReturnDueDate(e.target.value)}
          required
        />
        <Input
          label="Observações"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Opcional"
        />
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Itens previstos</h2>
          <Button variant="secondary" className="!w-auto" onClick={addLine}>
            + Item
          </Button>
        </div>
        {lines.map((line) => (
          <div key={line.key} className="rounded-lg border border-slate-200 p-3 space-y-2">
            <Select
              label="Do catálogo"
              value={line.catalogItemId}
              onChange={(e) => onCatalogPick(line.key, e.target.value)}
            >
              <option value="">— personalizado —</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {!line.catalogItemId && (
              <Input
                label="Nome do item"
                value={line.name}
                onChange={(e) => updateLine(line.key, { name: e.target.value })}
                placeholder="Ex.: Taça de cristal"
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="Unidade"
                value={line.unit}
                onChange={(e) => updateLine(line.key, { unit: e.target.value })}
              />
              <Input
                label="Qtd prevista"
                type="number"
                min={1}
                value={line.qtyPlanned}
                onChange={(e) =>
                  updateLine(line.key, { qtyPlanned: Math.max(1, Number(e.target.value)) })
                }
              />
            </div>
          </div>
        ))}
      </Card>

      <Button onClick={submit} disabled={saving}>
        {saving ? "Salvando…" : "Criar pedido"}
      </Button>
      {el}
    </div>
  );
}
