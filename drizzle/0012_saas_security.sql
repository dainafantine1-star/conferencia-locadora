-- Preserve existing accounts. The earliest manager becomes owner; other managers remain admins.
WITH ranked AS (SELECT id, row_number() OVER (PARTITION BY company_id ORDER BY created_at, id) AS n FROM memberships WHERE role = 'gestor')
UPDATE memberships m SET account_role = CASE WHEN r.n = 1 THEN 'owner' ELSE 'admin' END FROM ranked r WHERE m.id = r.id;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.detali_has_company(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT EXISTS (SELECT 1 FROM public.memberships m JOIN public.users u ON u.id = m.user_id
 WHERE m.company_id = target AND m.active AND u.active
 AND u.id::text = coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', ''))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.detali_own_user(target uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
 SELECT target::text = coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')
$$;
--> statement-breakpoint
DO $$ DECLARE t record; predicate text; BEGIN
 FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name IN ('agenda_slots','ai_actions','ai_agents','ai_deliveries','ai_jobs','ai_knowledge','ai_messages','ai_rules','ai_runs','ai_settings','ai_threads','attachments','audit_log','backup_runs','billing_events','catalog_items','checkin_records','client_portals','closures','commissions','companies','company_domains','company_invites','company_settings','customers','document_visits','financial_entries','fiscal_deliveries','fiscal_invoices','fiscal_settings','holidays','logistics_tasks','memberships','message_log','order_items','orders','payment_checkouts','platform_admins','platform_audit','product_records','rental_documents','request_limits','return_items','returns','saas_plans','saas_subscriptions','scan_labels','settlements','stock_movements','store_leads','store_pages','suppliers','users','venue_bookings') LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.table_name);
   IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t.table_name AND column_name = 'company_id') THEN predicate := 'public.detali_has_company(company_id)';
   ELSIF t.table_name = 'companies' THEN predicate := 'public.detali_has_company(id)';
   ELSIF t.table_name = 'users' THEN predicate := 'public.detali_own_user(id)';
   ELSIF t.table_name = 'order_items' THEN predicate := 'EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND public.detali_has_company(o.company_id))';
   ELSIF t.table_name = 'return_items' THEN predicate := 'EXISTS (SELECT 1 FROM public.returns r WHERE r.id = return_id AND public.detali_has_company(r.company_id))';
   ELSE predicate := 'false'; END IF;
   EXECUTE format('CREATE POLICY detali_tenant_select ON public.%I FOR SELECT USING (%s)', t.table_name, predicate);
   -- Browser clients never write SQL directly; authenticated application services validate actions and plans.
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon', t.table_name); END IF;
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t.table_name); END IF;
 END LOOP;
END $$;
--> statement-breakpoint
-- Reject tenant-mismatched foreign references at the database layer as well as in application services.
CREATE OR REPLACE FUNCTION public.detali_check_tenant_refs() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE payload jsonb := to_jsonb(NEW); tenant uuid; parent_tenant uuid; fk record; reference_value text;
BEGIN
 tenant := nullif(payload->>'company_id', '')::uuid;
 IF tenant IS NULL AND TG_TABLE_NAME = 'order_items' THEN SELECT company_id INTO tenant FROM public.orders WHERE id = (payload->>'order_id')::uuid; END IF;
 IF tenant IS NULL AND TG_TABLE_NAME = 'return_items' THEN SELECT company_id INTO tenant FROM public.returns WHERE id = (payload->>'return_id')::uuid; END IF;
 FOR fk IN
   SELECT a.attname AS child_column, p.relname AS parent_table, pa.attname AS parent_column
   FROM pg_constraint c JOIN pg_class p ON p.oid = c.confrelid
   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
   WHERE c.contype = 'f' AND c.conrelid = TG_RELID AND array_length(c.conkey, 1) = 1
   AND EXISTS (SELECT 1 FROM pg_attribute ca WHERE ca.attrelid = c.confrelid AND ca.attname = 'company_id' AND NOT ca.attisdropped)
 LOOP
   reference_value := payload->>fk.child_column;
   IF reference_value IS NOT NULL THEN
     EXECUTE format('SELECT company_id FROM public.%I WHERE %I::text = $1', fk.parent_table, fk.parent_column) INTO parent_tenant USING reference_value;
     -- order_items and return_items reference an intermediate table without company_id; handled below.
     IF parent_tenant IS NOT NULL AND tenant IS DISTINCT FROM parent_tenant THEN RAISE EXCEPTION 'Referência entre empresas diferentes em %.%', TG_TABLE_NAME, fk.child_column USING ERRCODE = '23514'; END IF;
   END IF;
 END LOOP;
 IF TG_TABLE_NAME = 'return_items' THEN
   SELECT o.company_id INTO parent_tenant FROM public.order_items i JOIN public.orders o ON o.id = i.order_id WHERE i.id = (payload->>'order_item_id')::uuid;
   IF tenant IS DISTINCT FROM parent_tenant THEN RAISE EXCEPTION 'Item de devolução de outra empresa' USING ERRCODE = '23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
 AND table_name IN ('agenda_slots','ai_actions','ai_agents','ai_deliveries','ai_jobs','ai_knowledge','ai_messages','ai_rules','ai_runs','ai_settings','ai_threads','attachments','audit_log','backup_runs','billing_events','catalog_items','checkin_records','client_portals','closures','commissions','companies','company_domains','company_invites','company_settings','customers','document_visits','financial_entries','fiscal_deliveries','fiscal_invoices','fiscal_settings','holidays','logistics_tasks','memberships','message_log','order_items','orders','payment_checkouts','platform_admins','platform_audit','product_records','rental_documents','request_limits','return_items','returns','saas_plans','saas_subscriptions','scan_labels','settlements','stock_movements','store_leads','store_pages','suppliers','users','venue_bookings') AND (EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = tables.table_name AND c.column_name = 'company_id') OR table_name IN ('order_items', 'return_items')) LOOP
 EXECUTE format('CREATE TRIGGER detali_tenant_refs BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.detali_check_tenant_refs()', t.table_name);
 END LOOP;
END $$;
--> statement-breakpoint
-- Storage exists only in Supabase. Buckets are private; backend authorization precedes service-role access.
DO $$ BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL THEN
   EXECUTE $q$INSERT INTO storage.buckets (id, name, public) VALUES ('detali-files', 'detali-files', false), ('detali-backups', 'detali-backups', false) ON CONFLICT (id) DO UPDATE SET public = false$q$;
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
     EXECUTE $q$CREATE POLICY detali_private_files ON storage.objects FOR SELECT TO authenticated USING (bucket_id IN ('detali-files', 'detali-backups') AND public.detali_has_company(CASE WHEN split_part(name, '/', 1) ~ '^[a-f0-9-]{36}$' THEN split_part(name, '/', 1)::uuid ELSE NULL END))$q$;
   END IF;
 END IF;
END $$;
