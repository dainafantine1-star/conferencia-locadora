CREATE TABLE "ai_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_deliveries" ADD CONSTRAINT "ai_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_deliveries_external_key" ON "ai_deliveries" USING btree ("company_id","external_id");
--> statement-breakpoint
ALTER TABLE "ai_deliveries" ENABLE ROW LEVEL SECURITY;
