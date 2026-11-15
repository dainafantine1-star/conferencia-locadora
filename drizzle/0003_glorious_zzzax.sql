CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"status" text NOT NULL,
	"storage_key" text,
	"checksum" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"settlement_id" uuid,
	"amount_cents" integer NOT NULL,
	"rate_bps" integer NOT NULL,
	"basis" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"slug" text,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"storefront" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"integrations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_secrets" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"description" text NOT NULL,
	"category" text DEFAULT 'geral' NOT NULL,
	"customer_id" uuid,
	"supplier_id" uuid,
	"document_id" uuid,
	"installment" integer,
	"amount_cents" integer NOT NULL,
	"due_date" date NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"day" date NOT NULL,
	"name" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'agendada' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"address" text NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"assignee_id" uuid,
	"vehicle" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"provider_id" text,
	"error" text,
	"document_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"provider_id" text,
	"url" text,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'criando' NOT NULL,
	"error" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rental_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"number" integer NOT NULL,
	"customer_id" uuid NOT NULL,
	"seller_id" uuid,
	"order_id" uuid,
	"parent_id" uuid,
	"event_name" text NOT NULL,
	"event_date" date NOT NULL,
	"return_due_date" date NOT NULL,
	"valid_until" date,
	"lines" jsonb NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"delivery_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"terms" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"delivery_address" text DEFAULT '' NOT NULL,
	"commission_bps" integer,
	"commission_basis" text,
	"commission_base_cents" integer,
	"snapshot" jsonb,
	"share_token_hash" text,
	"share_expires_at" timestamp with time zone,
	"signature" jsonb,
	"signed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"idempotency_key" text NOT NULL,
	"reversal_of" uuid,
	"provider_id" text,
	"receipt_number" text NOT NULL,
	"receipt_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"delta" integer DEFAULT 0 NOT NULL,
	"unavailable_delta" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"reference_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'novo' NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"event_date" date,
	"return_due_date" date,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"document_id" uuid,
	"request_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tax_id" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "unavailable_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "rental_price_cents" integer;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "price_unit" text DEFAULT 'evento' NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "image_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tax_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "permissions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "commission_bps" integer;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_document_id_rental_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."rental_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_document_id_rental_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."rental_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_tasks" ADD CONSTRAINT "logistics_tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_tasks" ADD CONSTRAINT "logistics_tasks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_tasks" ADD CONSTRAINT "logistics_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_tasks" ADD CONSTRAINT "logistics_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_checkouts" ADD CONSTRAINT "payment_checkouts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_checkouts" ADD CONSTRAINT "payment_checkouts_entry_id_financial_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."financial_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_checkouts" ADD CONSTRAINT "payment_checkouts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_documents" ADD CONSTRAINT "rental_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_documents" ADD CONSTRAINT "rental_documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_documents" ADD CONSTRAINT "rental_documents_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_documents" ADD CONSTRAINT "rental_documents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_documents" ADD CONSTRAINT "rental_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_entry_id_financial_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."financial_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_leads" ADD CONSTRAINT "store_leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_leads" ADD CONSTRAINT "store_leads_document_id_rental_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."rental_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_pages" ADD CONSTRAINT "store_pages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_runs_company_idx" ON "backup_runs" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commissions_settlement_key" ON "commissions" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "commissions_company_seller_idx" ON "commissions" USING btree ("company_id","seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_settings_slug_key" ON "company_settings" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "financial_entries_company_due_idx" ON "financial_entries" USING btree ("company_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_entries_document_installment_key" ON "financial_entries" USING btree ("document_id","installment");--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_company_day_name_key" ON "holidays" USING btree ("company_id","day","name");--> statement-breakpoint
CREATE INDEX "logistics_company_schedule_idx" ON "logistics_tasks" USING btree ("company_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "message_log_company_idx" ON "message_log" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_checkouts_provider_key" ON "payment_checkouts" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "payment_checkouts_entry_idx" ON "payment_checkouts" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_documents_number_key" ON "rental_documents" USING btree ("company_id","kind","number");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_documents_order_key" ON "rental_documents" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_documents_share_key" ON "rental_documents" USING btree ("share_token_hash");--> statement-breakpoint
CREATE INDEX "rental_documents_company_idx" ON "rental_documents" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_idempotency_key" ON "settlements" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_provider_key" ON "settlements" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "settlements_entry_idx" ON "settlements" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "stock_movements_company_item_idx" ON "stock_movements" USING btree ("company_id","catalog_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_leads_request_key" ON "store_leads" USING btree ("company_id","request_key");--> statement-breakpoint
CREATE INDEX "store_leads_company_idx" ON "store_leads" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_pages_slug_key" ON "store_pages" USING btree ("company_id","slug");--> statement-breakpoint
CREATE INDEX "suppliers_company_idx" ON "suppliers" USING btree ("company_id");