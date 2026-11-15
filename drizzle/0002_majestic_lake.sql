CREATE TABLE "agenda_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"day" date NOT NULL,
	"hour" text NOT NULL,
	"capacity" integer NOT NULL,
	"booked" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "stock_qty" integer;--> statement-breakpoint
ALTER TABLE "agenda_slots" ADD CONSTRAINT "agenda_slots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agenda_slots_company_day_hour_key" ON "agenda_slots" USING btree ("company_id","day","hour");