"use client";
import Link from "next/link";
import { Commercial } from "./Commercial";
import { Finance, Commissions } from "./Finance";
import { Inventory, Suppliers, Customers, Logistics } from "./Operations";
import { Settings, Holidays, Backups, Team } from "./Settings";
import { Store } from "./Store";
import { Reports } from "./Reports";
import { InstallApp } from "@/components/InstallApp";
import { useModule, Card, Spinner, type Options, dateLabel } from "./shared";
const modules = [
  ["comercial", "Orçamentos e contratos", "Preços, parcelas e assinatura", "comercial"],
  ["financeiro", "Financeiro", "Contas, baixas e recibos", "financeiro"],
  ["estoque", "Estoque", "Inventário e disponibilidade por período", "estoque"],
  ["clientes", "Clientes", "Cadastro completo e contatos", "clientes"],
  ["fornecedores", "Fornecedores", "Cadastro de parceiros", "clientes"],
  ["logistica", "Logística", "Entregas, coletas e responsáveis", "logistica"],
  ["comissoes", "Comissões", "Apuração e pagamento da equipe", "financeiro"],
  ["relatorios", "Relatórios", "Contratos e fluxo de caixa", "relatorios"],
  ["feriados", "Feriados", "Calendário e datas locais", ""],
  ["loja", "Loja integrada", "Produtos, páginas e solicitações", "gestor"],
  ["configuracoes", "Configurações", "Empresa, regras e integrações", "gestor"],
  ["equipe", "Equipe e permissões", "Acessos e comissão por usuário", "gestor"],
  ["backups", "Backups", "Cópias e histórico de execução", "gestor"],
  ["mensagens", "Histórico de envios", "Status informado pelo provedor", "gestor"],
];
export function Management({ section = "" }: { section?: string }) {
  const api = useModule<Options>("opcoes");
  const options = api.data;
  if (!options) return <>{api.feedback}{!api.error && <Spinner />}</>;
  const allowed = modules.filter(m => options.role === "gestor" || !m[3] || options.permissions.includes(m[3]));
  const selected = allowed.find(m => m[0] === section);
  return <div className="space-y-5"><div><p className="mb-1 text-xs font-bold uppercase tracking-widest text-action">Detali · Gestão</p><h1 className="text-2xl font-bold">{selected?.[1] ?? "Toda a operação em um lugar"}</h1><p className="mt-1 text-sm text-slate-600">{selected?.[2] ?? "Escolha um módulo para acompanhar a locadora."}</p></div>
    {section && <Link href="/gestao" className="inline-flex min-h-11 items-center text-sm font-semibold text-action underline">← Todos os módulos</Link>}
    {section && !selected ? <p role="alert">Módulo não disponível para seu perfil.</p> : !section ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{allowed.map(([id, title, hint]) => <Link key={id} href={`/gestao/${id}`} className="group"><Card className="h-full transition group-hover:border-action"><h2 className="font-semibold">{title} <span className="text-action">↗</span></h2><p className="mt-2 text-sm text-slate-600">{hint}</p></Card></Link>)}</div> : <>
      {section === "comercial" && <Commercial options={options} />}{section === "financeiro" && <Finance options={options} />}{section === "comissoes" && <Commissions />}{section === "estoque" && <Inventory options={options} />}{section === "clientes" && <Customers options={options} />}{section === "fornecedores" && <Suppliers />}{section === "logistica" && <Logistics options={options} />}{section === "configuracoes" && <Settings />}{section === "loja" && <Store />}{section === "feriados" && <Holidays canManage={options.role === "gestor"} />}{section === "backups" && <Backups />}{section === "equipe" && <Team />}{section === "relatorios" && <Reports />}{section === "mensagens" && <Messages />}
    </>}{!section && <InstallApp />}</div>;
}
function Messages() {
  const api = useModule<{ messages: { id: string; channel: string; recipient: string; subject: string; status: string; providerId: string | null; error: string | null; createdAt: string }[] }>("mensagens");
  return <div className="space-y-3">{api.feedback}<p className="text-sm text-slate-600">“Enviado” significa aceito pelo servidor ou pela API. A confirmação de entrega ao destinatário depende do serviço. Envios incertos exigem conferência no provedor antes de repetir.</p>{!api.data && !api.error && <Spinner />}{api.data?.messages.length === 0 && <p className="text-sm">Nenhum envio registrado.</p>}{api.data?.messages.map(m => <Card key={m.id}><p className="font-semibold">{m.subject}</p><p className="text-sm">{m.channel} · {m.recipient} · {m.status}</p><p className="break-all text-xs text-slate-600">{dateLabel(m.createdAt)} · {m.providerId}</p>{m.error && <p className="mt-2 text-sm text-red-800">{m.error}</p>}</Card>)}</div>;
}
