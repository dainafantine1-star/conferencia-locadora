"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Badge, Spinner, EmptyState, Button, Input } from "@/components/ui";

type OrderRow = {
  id: string;
  number: number;
  status: string;
  billingStatus: string;
  eventName: string;
  eventDate: string;
  returnDueDate: string;
  customerName: string;
};

export default function PedidosPage() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/pedidos?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Falha ao carregar"))))
        .then((d) => setOrders(d.orders))
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Pedidos</h1>
        <Link href="/pedidos/novo" className="w-auto">
          <Button className="!w-auto">+ Novo</Button>
        </Link>
      </div>

      <Input
        label="Buscar"
        placeholder="Número, evento ou cliente"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {!orders && !error && <Spinner />}
      {orders && orders.length === 0 && (
        <EmptyState title="Nenhum pedido encontrado" hint="Crie um novo pedido ou ajuste a busca." />
      )}
      {orders && orders.length > 0 && (
        <ul className="space-y-2">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/pedidos/${o.id}`}>
                <Card>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        #{o.number} · {o.eventName}
                      </p>
                      <p className="text-sm text-slate-500">{o.customerName}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        Evento {fmt(o.eventDate)} · retorno {fmt(o.returnDueDate)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge status={o.status} />
                      <Badge status={o.billingStatus} />
                    </div>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fmt(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
