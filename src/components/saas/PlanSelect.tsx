"use client";
import { Select, money } from "@/components/ui";
import { useModule } from "@/components/management/shared";
export function PlanSelect({ name, label = "Plano inicial" }: { name: string; label?: string }) {
  const api = useModule<{ plans: { id: string; name: string; monthlyCents: number | null }[] }>("planos", "", "/api/saas");
  return <Select name={name} label={label} defaultValue="essencial">{api.data ? api.data.plans.map(p => <option key={p.id} value={p.id}>{p.name} · {p.monthlyCents === null ? "preço a definir" : `${money(p.monthlyCents)}/mês`}</option>) : <><option value="essencial">Essencial · consultando preço</option><option value="plus">Plus · consultando preço</option></>}</Select>;
}
