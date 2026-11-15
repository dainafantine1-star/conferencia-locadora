export const ACTIONS = ["view", "create", "edit", "delete", "financial"] as const;
export type AccessAction = typeof ACTIONS[number];
export type AccountRole = "owner" | "admin" | "member";
export type Grants = Partial<Record<FeatureId, AccessAction[]>>;
export const FEATURES = [
  { id: "users", name: "Usuários e permissões", path: "/conta", permission: "gestor", status: "existente", detail: "Convites com prazo, perfis, acesso individual e troca de empresa." },
  { id: "customers", name: "Clientes", path: "/clientes", permission: "clientes", status: "existente", detail: "Contatos e documentos vinculados ao cliente." },
  { id: "suppliers", name: "Fornecedores", path: "/gestao/fornecedores", permission: "clientes", status: "parcial", detail: "Cadastro e cotações; catálogo de categorias e serviços ainda pendente." },
  { id: "events", name: "Gestão de eventos", path: "/produto/eventos", permission: "comercial", status: "parcial", detail: "Eventos, cronograma, tarefas e responsáveis. Modelos avançados de documentos pendentes." },
  { id: "proposals", name: "Propostas por e-mail e WhatsApp", path: "/gestao/comercial", permission: "comercial", status: "existente", detail: "Orçamentos, contratos, links, histórico e métricas de acesso; envio exige provedor." },
  { id: "finance", name: "Financeiro", path: "/gestao/financeiro", permission: "financeiro", status: "existente", detail: "Contas, parcelas, baixas, despesas, recibos e comissões." },
  { id: "pipeline", name: "Funil de vendas", path: "/produto/funil", permission: "comercial", status: "existente", detail: "Etapas, leads, clientes, eventos e histórico de alterações." },
  { id: "checkin", name: "Check-in por QR Code", path: "/produto/checkin", permission: "comercial", status: "existente", detail: "Participantes importados e leitura de QR; ambos consomem a mesma cota mensal." },
  { id: "weekly", name: "Relatório semanal para clientes", path: "/produto/portal", permission: "comercial", status: "parcial", detail: "Portal e relatório da semana. Envio de segunda-feira exige SMTP e agendador." },
  { id: "apps", name: "Loja de Apps", path: "/produto/apps", permission: "", status: "existente", detail: "Catálogo de integrações, disponibilidade e custos ainda não definidos." },
  { id: "sites", name: "Criador de sites", path: "/gestao/loja", permission: "gestor", status: "parcial", detail: "Loja, páginas, banners e captação integrada. Editor visual livre pendente." },
  { id: "venues", name: "Agenda de locais", path: "/produto/locais", permission: "comercial", status: "existente", detail: "Locais e reservas por período, com bloqueio de sobreposição por local." },
  { id: "training", name: "Treinamentos da equipe", path: "/produto/treinamentos", permission: "", status: "existente", detail: "Conteúdo interno, atribuição à equipe e conclusão registrada." },
  { id: "invoices", name: "Notas fiscais", path: "/notas-fiscais", permission: "fiscal", status: "parcial", detail: "NF-e de produtos/remessa via Focus NFe; NFS-e de serviços pendente. Credenciais e homologação necessárias." },
  { id: "domains", name: "Link exclusivo", path: "/produto/dominios", permission: "gestor", status: "parcial", detail: "Cadastro e verificação DNS; vínculo TLS e domínio na hospedagem depende da conta do provedor." },
  { id: "responsibles", name: "Múltiplos responsáveis por evento", path: "/produto/eventos", permission: "comercial", status: "parcial", detail: "Vários clientes por evento. Assinatura conjunta e contratos individuais automáticos pendentes." },
  { id: "quotations", name: "Gestão de cotações", path: "/produto/cotacoes", permission: "clientes", status: "parcial", detail: "Solicitação, respostas, comparação e aprovação; envio automático ao fornecedor pendente." },
  { id: "advanced_finance", name: "Financeiro avançado", path: "/produto/financeiro", permission: "financeiro", status: "parcial", detail: "Comprovantes privados e resultado gerencial de caixa; conciliação bancária e DRE por competência pendentes." },
  { id: "advanced_proposals", name: "Propostas avançadas", path: "/gestao/comercial", permission: "comercial", status: "parcial", detail: "Preços por item e período existentes; tabelas alternativas e automações específicas pendentes." },
  { id: "support", name: "Suporte", path: "/produto/suporte", permission: "", status: "parcial", detail: "Solicitações e preferência de agendamento. Canais, SLA e operação humana precisam ser definidos." },
  { id: "inventory", name: "Estoque e reservas de locação", path: "/gestao/estoque", permission: "estoque", status: "parcial", detail: "Estoque, etiquetas de caixas, disponibilidade e reservas. Composição de kits com itens distintos pendente." },
  { id: "returns", name: "Saída e devolução", path: "/pedidos", permission: "logistica", status: "existente", detail: "Conferência, fotos de avarias, reposição e fechamento financeiro." },
  { id: "attendance", name: "Atendimento e agentes WhatsApp", path: "/atendimento", permission: "atendimento", status: "existente", detail: "Meta/WAHA, automações e atendimento; exige serviço conectado e worker." },
  { id: "assistant", name: "Assistente interno", path: "/painel", permission: "", status: "existente", detail: "Guia local e comandos com provedor de IA configurado." },
  { id: "reports", name: "Relatórios gerenciais", path: "/gestao/relatorios", permission: "relatorios", status: "existente", detail: "Relatórios e exportação CSV." },
  { id: "backups", name: "Backups", path: "/gestao/backups", permission: "gestor", status: "existente", detail: "Arquivos criptografados e recuperação; requer armazenamento permanente e agendador." },
] as const;
export type FeatureId = typeof FEATURES[number]["id"];
export type PlanFeatures = Record<FeatureId, boolean>;
export const LIMITS = ["users", "checkins_month", "venues"] as const;
export type LimitKey = typeof LIMITS[number];
export type PlanLimits = Record<LimitKey, number | null>;
export const allFeatures = () => Object.fromEntries(FEATURES.map(f => [f.id, true])) as PlanFeatures;
export const openLimits = (): PlanLimits => ({ users: null, checkins_month: null, venues: null });
export const featureById = (id: string) => FEATURES.find(f => f.id === id);
export const permissionFeature: Record<string, FeatureId> = { comercial: "proposals", financeiro: "finance", logistica: "returns", relatorios: "reports", estoque: "inventory", clientes: "customers", atendimento: "attendance", fiscal: "invoices" };
