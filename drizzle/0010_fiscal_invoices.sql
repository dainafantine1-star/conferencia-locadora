CREATE TABLE "fiscal_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"recipient" text NOT NULL,
	"status" text NOT NULL,
	"provider_id" text,
	"error" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_id" uuid,
	"request_key" text NOT NULL,
	"environment" text NOT NULL,
	"reference" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"payload" jsonb,
	"products_cents" integer NOT NULL,
	"provider_status" text,
	"number" text,
	"series" text,
	"access_key" text,
	"protocol" text,
	"pdf_path" text,
	"xml_path" text,
	"message" text,
	"pdf_data" text,
	"xml_data" text,
	"pdf_sha256" text,
	"xml_sha256" text,
	"submitted_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"preferences" jsonb NOT NULL,
	"encrypted_secrets" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiscal_deliveries" ADD CONSTRAINT "fiscal_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_deliveries" ADD CONSTRAINT "fiscal_deliveries_invoice_id_fiscal_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fiscal_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_deliveries" ADD CONSTRAINT "fiscal_deliveries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_invoices" ADD CONSTRAINT "fiscal_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_invoices" ADD CONSTRAINT "fiscal_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_invoices" ADD CONSTRAINT "fiscal_invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_invoices" ADD CONSTRAINT "fiscal_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_settings" ADD CONSTRAINT "fiscal_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_deliveries_request_key" ON "fiscal_deliveries" USING btree ("company_id","request_key");--> statement-breakpoint
CREATE INDEX "fiscal_deliveries_invoice_idx" ON "fiscal_deliveries" USING btree ("company_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_invoices_request_key" ON "fiscal_invoices" USING btree ("company_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_invoices_reference_key" ON "fiscal_invoices" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "fiscal_invoices_company_idx" ON "fiscal_invoices" USING btree ("company_id","created_at");
--> statement-breakpoint
ALTER TABLE "fiscal_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fiscal_invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fiscal_deliveries" ENABLE ROW LEVEL SECURITY;
