-- Infrastructure for the Supabase project (not for embedded PGlite).
-- Run as the database owner. Supply the production URL and CRON_SECRET through
-- Vault separately; never put credentials in this script or cron.job.command.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION detali_private.invoke_production_job(job_name text)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  base_url text;
  cron_secret text;
  request_id bigint;
BEGIN
  IF job_name NOT IN ('atendimento', 'backups', 'relatorio-semanal') THEN
    RAISE EXCEPTION 'Unknown production job';
  END IF;
  -- Do not wake Vercel every minute when there is no work to process.
  IF job_name = 'atendimento' AND NOT EXISTS (
    SELECT 1 FROM public.ai_jobs
    WHERE (status = 'aguardando' AND due_at <= now())
       OR (status = 'executando' AND started_at < now() - interval '10 minutes')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.ai_messages
    WHERE status = 'enviando' AND created_at < now() - interval '10 minutes'
  ) THEN RETURN NULL; END IF;
  IF job_name = 'backups' AND NOT EXISTS (
    SELECT 1 FROM public.company_settings
    WHERE preferences->>'backupEnabled' = 'true'
  ) THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets
    WHERE name = 'detali_production_url';
  SELECT decrypted_secret INTO cron_secret FROM vault.decrypted_secrets
    WHERE name = 'detali_production_cron_secret';
  -- The bearer secret may only be sent to this application's production domain.
  IF base_url IS DISTINCT FROM 'https://conferencia-locadora.vercel.app'
     OR cron_secret IS NULL OR length(cron_secret) < 32 THEN
    RAISE EXCEPTION 'Production scheduler configuration missing or invalid';
  END IF;
  SELECT net.http_post(
    url := base_url || '/api/cron/' || job_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || cron_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  ) INTO request_id;
  RETURN request_id;
END;
$$;
REVOKE ALL ON FUNCTION detali_private.invoke_production_job(text) FROM PUBLIC;
DO $$ DECLARE client_role text; BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION detali_private.invoke_production_job(text) FROM %I', client_role);
    END IF;
  END LOOP;
END $$;

-- Install paused. Activate these jobs only after testing the production domain.
SELECT cron.schedule('detali-production-attendance', '* * * * *',
  $$SELECT detali_private.invoke_production_job('atendimento');$$);
SELECT cron.schedule('detali-production-backups', '*/15 * * * *',
  $$SELECT detali_private.invoke_production_job('backups');$$);
SELECT cron.schedule('detali-production-weekly', '0 11 * * 1',
  $$SELECT detali_private.invoke_production_job('relatorio-semanal');$$);
SELECT cron.alter_job(jobid, active := false) FROM cron.job
WHERE jobname IN ('detali-production-attendance', 'detali-production-backups', 'detali-production-weekly');
