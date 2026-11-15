-- Acesso de dados exclusivamente pelo servidor. Sem policies para anon/authenticated.
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "catalog_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "scan_labels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agenda_slots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "returns" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "return_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "closures" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "company_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rental_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "financial_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "settlements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commissions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "logistics_tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "store_pages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "store_leads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "message_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "request_limits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "backup_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_checkouts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_agents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_knowledge" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_threads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_actions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_jobs" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE IF EXISTS "drizzle_migrations" ENABLE ROW LEVEL SECURITY;
