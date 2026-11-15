ALTER TYPE "public"."order_status" ADD VALUE 'cancelado';--> statement-breakpoint
CREATE TABLE "request_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_entries" ADD COLUMN "closure_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD COLUMN "credited_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "message_log" ADD COLUMN "request_key" text;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_closure_id_closures_id_fk" FOREIGN KEY ("closure_id") REFERENCES "public"."closures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_entries_closure_key" ON "financial_entries" USING btree ("closure_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_log_request_key" ON "message_log" USING btree ("company_id","request_key");