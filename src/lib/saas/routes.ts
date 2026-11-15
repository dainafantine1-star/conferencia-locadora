import type { FeatureId } from "./catalog";
export const moduleFeatures: Record<string, FeatureId> = { fornecedores: "suppliers", clientes: "customers", estoque: "inventory", comercial: "proposals", financeiro: "finance", comissoes: "finance", logistica: "returns", relatorios: "reports", documentos: "proposals", recibos: "finance", loja: "sites", backups: "backups", equipe: "users" };
export function routeFeature(path: string): FeatureId | undefined {
  const section = path.split("/").filter(Boolean);
  if (section[0] === "gestao") return moduleFeatures[section[1]];
  if (section[0] === "produto") return ({ eventos: "events", funil: "pipeline", checkin: "checkin", locais: "venues", treinamentos: "training", cotacoes: "quotations", suporte: "support", dominios: "domains", portal: "weekly", apps: "apps", financeiro: "advanced_finance" } as Record<string, FeatureId>)[section[1]];
  return ({ pedidos: "returns", clientes: "customers", catalogo: "inventory", calendario: "events", atendimento: "attendance", "notas-fiscais": "invoices", equipe: "users" } as Record<string, FeatureId>)[section[0]];
}
