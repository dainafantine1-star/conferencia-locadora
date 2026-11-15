-- Keep RLS helpers outside the API's exposed public schema. PostgreSQL updates
-- policy/trigger dependencies by function OID when moving the functions.
CREATE SCHEMA IF NOT EXISTS detali_private;
REVOKE ALL ON SCHEMA detali_private FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION public.detali_has_company(uuid) SET SCHEMA detali_private;
ALTER FUNCTION public.detali_own_user(uuid) SET SCHEMA detali_private;
ALTER FUNCTION public.detali_check_tenant_refs() SET SCHEMA detali_private;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA detali_private FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE client_role text; BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA detali_private FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA detali_private FROM %I', client_role);
      IF client_role <> 'anon' THEN
        EXECUTE format('GRANT USAGE ON SCHEMA detali_private TO %I', client_role);
        EXECUTE format('GRANT EXECUTE ON FUNCTION detali_private.detali_has_company(uuid), detali_private.detali_own_user(uuid) TO %I', client_role);
      END IF;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- Migration bookkeeping is accessible only through the database owner backend.
DO $$ BEGIN
  IF to_regclass('public.drizzle_migrations') IS NOT NULL THEN
    ALTER TABLE public.drizzle_migrations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY detali_no_client_access ON public.drizzle_migrations FOR ALL USING (false) WITH CHECK (false);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.drizzle_migrations FROM anon; END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.drizzle_migrations FROM authenticated; END IF;
  END IF;
END $$;
