"use client";

import { useEffect, useState } from "react";
import { Card, Button, Input, Select, useToast, Spinner, EmptyState, money } from "@/components/ui";

type Item = {
  id: string;
  name: string;
  unit: string;
  stockQty: number | null;
  replacementCents: number;
  damageCents: number | null;
};

type Label = {
  id: string;
  code: string;
  kind: "unidade" | "caixa";
  qty: number;
  catalogName: string;
  unit: string;
  active: boolean;
};

export default function CatalogoPage() {
  const { toast, el } = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [labels, setLabels] = useState<Label[]>([]);
  const [name, setName] = useState("");
  const [stock, setStock] = useState("");
  const [stockSaving, setStockSaving] = useState<string | null>(null);
  const [unit, setUnit] = useState("un");
  const [repl, setRepl] = useState("");
  const [dmg, setDmg] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // etiquetas
  const [labelItem, setLabelItem] = useState("");
  const [labelKind, setLabelKind] = useState<"unidade" | "caixa">("unidade");
  const [labelCount, setLabelCount] = useState(1);
  const [genSaving, setGenSaving] = useState(false);
  const [showLabels, setShowLabels] = useState(false);

  const load = () => {
    fetch("/api/catalogo")
      .then((r) => r.json())
      .then((d) => { setItems(d.items); setCanManage(Boolean(d.canManage)); })
      .catch(() => setError("Falha ao carregar"));
    fetch("/api/etiquetas")
      .then((r) => (r.ok ? r.json() : { labels: [] }))
      .then((d) => setLabels(d.labels ?? []))
      .catch(() => {});
  };
  useEffect(load, []);

  async function add() {
    setSaving(true);
    setError(null);
    try {
      const replacementCents = Math.round(parseFloat(repl.replace(",", ".")) * 100);
      if (!Number.isFinite(replacementCents) || replacementCents < 0 || !name.trim()) {
        throw new Error("Nome e valor de reposição válidos são obrigatórios");
      }
      const damageCentsRaw = dmg.trim()
        ? Math.round(parseFloat(dmg.replace(",", ".")) * 100)
        : null;
      const res = await fetch("/api/catalogo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          stockQty: stock.trim() ? Number(stock) : null,
          unit: unit || "un",
          replacementCents,
          damageCents: damageCentsRaw,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast("Item adicionado");
      setName("");
      setStock("");
      setRepl("");
      setDmg("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  async function generateLabels() {
    if (!labelItem) {
      toast("Escolha um item");
      return;
    }
    setGenSaving(true);
    try {
      const res = await fetch("/api/etiquetas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogItemId: labelItem,
          kind: labelKind,
          count: labelCount,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      const n = d.labels?.length ?? 0;
      toast(
        labelKind === "unidade"
          ? `${n} etiqueta(s) de unidade gerada(s)`
          : `Caixa gerada: ${labelCount} ${d.item ?? ""}/bipagem`,
      );
      setShowLabels(true);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Erro");
    } finally {
      setGenSaving(false);
    }
  }

  function printLabels() { window.open("/api/etiquetas/imprimir", "_blank", "noopener,noreferrer"); }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Catálogo</h1>
      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {canManage && <Card className="space-y-3">
        <h2 className="font-semibold">Novo item</h2>
        <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} placeholder="Taça de cristal" />
        <Input label="Estoque total (opcional)" type="number" min={0} step={1} value={stock} onChange={(e) => setStock(e.target.value)} placeholder="Quantidade para locação" />
        <div className="grid grid-cols-3 gap-2">
          <Input label="Unidade" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <Input
            label="Reposição (R$)"
            value={repl}
            onChange={(e) => setRepl(e.target.value)}
            inputMode="decimal"
            placeholder="12,00"
          />
          <Input
            label="Avaria (R$)"
            value={dmg}
            onChange={(e) => setDmg(e.target.value)}
            inputMode="decimal"
            placeholder="opcional"
          />
        </div>
        <p className="text-xs text-slate-500">
          Sem valor de avaria, usa-se o de reposição como sugestão.
        </p>
        <Button onClick={add} disabled={saving}>
          {saving ? "Salvando…" : "Adicionar"}
        </Button>
      </Card>}

      <Card className="space-y-3">
        <h2 className="font-semibold">Etiquetas para bipagem</h2>
        <p className="text-xs text-slate-500">
          <strong>Unidade:</strong> 1 código por peça (bipagem conta 1).{" "}
          <strong>Caixa:</strong> 1 código por caixa/kit (bipagem conta N unidades).
        </p>
        <Select
          label="Item do catálogo"
          value={labelItem}
          onChange={(e) => setLabelItem(e.target.value)}
        >
          <option value="">Selecione…</option>
          {items?.map((it) => (
            <option key={it.id} value={it.id}>
              {it.name}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Select
            label="Tipo"
            value={labelKind}
            onChange={(e) => setLabelKind(e.target.value as "unidade" | "caixa")}
          >
            <option value="unidade">Unidade (1/un)</option>
            <option value="caixa">Caixa/kit (N/un)</option>
          </Select>
          <Input
            label={labelKind === "unidade" ? "Qtd de etiquetas" : "Unidades por bipagem"}
            type="number"
            min={1}
            max={500}
            value={labelCount}
            onChange={(e) => setLabelCount(Math.max(1, Number(e.target.value)))}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => void generateLabels()} disabled={genSaving || !labelItem}>
            {genSaving ? "Gerando…" : "Gerar etiquetas"}
          </Button>
          <Button
            variant="secondary"
            onClick={printLabels}
            disabled={labels.length === 0}
          >
            Imprimir ({labels.length})
          </Button>
        </div>
        <Button variant="ghost" onClick={() => setShowLabels((v) => !v)}>
          {showLabels ? "Ocultar códigos" : "Ver códigos gerados"}
        </Button>
        {showLabels && labels.length > 0 && (
          <ul className="max-h-48 overflow-y-auto space-y-1 text-xs">
            {labels.map((l) => (
              <li key={l.id} className="flex justify-between rounded bg-slate-50 px-2 py-1">
                <span className="font-mono font-bold">{l.code}</span>
                <span className="text-slate-500">
                  {l.catalogName} ·{" "}
                  {l.kind === "caixa" ? `caixa +${l.qty}` : "unidade"} ·{" "}
                  {l.active ? "ativa" : "inativa"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!items && <Spinner />}
      {items && items.length === 0 && <EmptyState title="Catálogo vazio" />}
      {items && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it) => {
            const count = labels.filter((l) => l.catalogName === it.name).length;
            return (
              <li key={it.id}>
                <Card className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{it.name}</p>
                    {canManage && <form className="my-2 flex flex-wrap items-end gap-2" onSubmit={async (e) => {
                      e.preventDefault();
                      const value = new FormData(e.currentTarget).get("stock") as string;
                      setStockSaving(it.id);
                      try {
                        const r = await fetch("/api/catalogo", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: it.id, stockQty: value.trim() ? Number(value) : null }) });
                        const d = await r.json();
                        if (!r.ok) throw new Error(d.error);
                        toast("Estoque atualizado"); load();
                      } catch (e) { toast(e instanceof Error ? e.message : "Falha ao atualizar"); }
                      finally { setStockSaving(null); }
                    }}>
                      <Input key={it.stockQty ?? "empty"} label="Estoque total" name="stock" type="number" min={0} step={1} defaultValue={it.stockQty ?? ""} placeholder="Não informado" />
                      <Button type="submit" variant="secondary" disabled={stockSaving === it.id}>Salvar estoque</Button>
                    </form>}
                    <p className="text-sm text-slate-500">
                      Reposição {money(it.replacementCents)} · Avaria{" "}
                      {it.damageCents != null ? money(it.damageCents) : "—"} / {it.unit}
                    </p>
                  </div>
                  {count > 0 && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                      {count} etiqueta(s)
                    </span>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {el}
    </div>
  );
}
