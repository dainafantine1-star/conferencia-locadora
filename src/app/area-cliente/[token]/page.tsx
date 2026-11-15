import { portalData } from "@/lib/saas/product";
import { Brand } from "@/components/Brand";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export const metadata = { title: "Área do cliente | Detali", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function ClientArea({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params; const data = await portalData(token).catch(() => null); if (!data) notFound();
  return <main className="mx-auto max-w-4xl space-y-6 p-6"><Brand width={160} /><h1 className="text-3xl font-bold">Seus eventos</h1><p>Informações compartilhadas pela empresa responsável.</p>{data.events.map(e => <section key={e.id} className="rounded-2xl border bg-white p-5"><h2 className="text-xl font-semibold">{e.eventName}</h2><p>{e.eventDate.split("-").reverse().join("/")} · {e.status}</p><ul className="mt-3 space-y-2">{data.tasks.filter(t => t.orderId === e.id).map((t, i) => <li key={i}>{t.done ? "✓" : "○"} {t.name} — {t.dueDate.split("-").reverse().join("/")}</li>)}</ul></section>)}<h2 className="text-xl font-bold">Documentos vinculados</h2>{data.documents.map(d => <p key={d.id}>{d.kind} {d.number} · {d.eventName} · {(d.totalCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · {d.status}</p>)}<p className="text-sm text-slate-600">Para acessar ou assinar uma proposta, solicite o link individual do documento à empresa.</p></main>;
}
