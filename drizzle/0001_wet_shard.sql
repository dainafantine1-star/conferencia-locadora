CREATE TYPE "public"."label_kind" AS ENUM('unidade', 'caixa');--> statement-breakpoint
CREATE TABLE "scan_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" "label_kind" DEFAULT 'unidade' NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scan_labels" ADD CONSTRAINT "scan_labels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_labels" ADD CONSTRAINT "scan_labels_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_labels_company_code_key" ON "scan_labels" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "scan_labels_catalog_idx" ON "scan_labels" USING btree ("catalog_item_id");