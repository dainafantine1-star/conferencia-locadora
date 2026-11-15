import type { BackupPayload } from "./backup-format";
export const restoreOrder = ["companies", "users", "memberships", "customers", "catalog_items", "scan_labels", "agenda_slots", "suppliers", "orders", "order_items", "returns", "return_items", "attachments", "closures", "billing_events", "audit_log", "company_settings", "stock_movements", "rental_documents", "financial_entries", "settlements", "commissions", "logistics_tasks", "store_pages", "store_leads", "message_log", "holidays", "payment_checkouts", "ai_settings", "ai_agents", "ai_knowledge", "ai_threads", "ai_messages", "ai_actions", "ai_runs", "ai_rules", "ai_jobs", "ai_deliveries", "fiscal_settings", "fiscal_invoices", "fiscal_deliveries"];
type Query = (query: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
const quoted = (v: string) => `"${v.replaceAll('"', '""')}"`;
export async function restoreTables(payload: BackupPayload, query: Query) {
  const existing = await query("select (select count(*) from companies)::int as companies, (select count(*) from users)::int as users");
  if (Number(existing.rows[0].companies) || Number(existing.rows[0].users)) throw new Error("A restauração exige banco vazio e já migrado. Dados existentes não serão sobrescritos.");
  if (Object.keys(payload.tables).some(table => !restoreOrder.includes(table))) throw new Error("Backup contém tabela não reconhecida");
  if (payload.tables.companies?.length !== 1 || payload.tables.companies[0].id !== payload.companyId) throw new Error("Empresa do backup inválida");
  await query("BEGIN");
  try {
    for (const table of restoreOrder) {
      const columns = await query("select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1", [table]);
      const allowed = new Map(columns.rows.map(r => [String(r.column_name), String(r.data_type)]));
      for (const row of payload.tables[table] ?? []) {
        if (row.company_id && row.company_id !== payload.companyId) throw new Error("Backup contém dados de outra empresa");
        const keys = Object.keys(row);
        if (!keys.length || keys.some(key => !allowed.has(key))) throw new Error(`Coluna não reconhecida em ${table}`);
        const params = keys.map(key => row[key] !== null && ["json", "jsonb"].includes(allowed.get(key)!) ? JSON.stringify(row[key]) : row[key]);
        await query(`insert into ${quoted(table)} (${keys.map(quoted).join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`, params);
      }
    }
    await query("COMMIT");
  } catch (error) { await query("ROLLBACK"); throw error; }
  return { tables: restoreOrder.length, rows: Object.values(payload.tables).reduce((sum, rows) => sum + rows.length, 0) };
}
