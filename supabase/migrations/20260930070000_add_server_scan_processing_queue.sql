-- Server-side scan analysis queue.
--
-- New scans are persisted first and analyzed by a durable server worker. This
-- keeps processing alive even when the mobile app is backgrounded or killed.
-- Existing scans are already complete and are not reprocessed.

ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS analysis_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS analysis_error text,
  ADD COLUMN IF NOT EXISTS analysis_updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.scans
SET analysis_status = 'completed',
    analysis_updated_at = COALESCE(analysis_updated_at, now())
WHERE analysis_status = 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scans_analysis_status_check'
      AND conrelid = 'public.scans'::regclass
  ) THEN
    ALTER TABLE public.scans
      ADD CONSTRAINT scans_analysis_status_check
      CHECK (analysis_status = ANY (
        ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'partial'::text, 'failed'::text]
      ));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.scan_analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL UNIQUE
    REFERENCES public.scans(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  lock_until timestamptz,
  ingredient_names text[] NOT NULL DEFAULT '{}'::text[],
  ingredient_cursor integer NOT NULL DEFAULT 0 CHECK (ingredient_cursor >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT scan_analysis_jobs_status_check
    CHECK (status = ANY (
      ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]
    ))
);

CREATE INDEX IF NOT EXISTS scan_analysis_jobs_ready_idx
  ON public.scan_analysis_jobs (next_attempt_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS scan_analysis_jobs_lock_idx
  ON public.scan_analysis_jobs (lock_until)
  WHERE status = 'processing';

ALTER TABLE public.scan_analysis_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.scan_analysis_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scan_analysis_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.get_scan_analysis_worker_token()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'vault'
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'scan_analysis_worker_token'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_scan_analysis_worker_token() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_scan_analysis_worker_token() TO service_role;

CREATE OR REPLACE FUNCTION public.claim_scan_analysis_job()
RETURNS TABLE (
  job_id uuid,
  scan_id uuid,
  attempts integer,
  ingredient_names text[],
  ingredient_cursor integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  WITH candidate AS (
    SELECT j.id
    FROM public.scan_analysis_jobs AS j
    WHERE j.next_attempt_at <= now()
      AND (
        j.status = 'pending'
        OR (j.status = 'processing' AND j.lock_until < now())
      )
    ORDER BY j.next_attempt_at, j.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.scan_analysis_jobs AS j
  SET status = 'processing',
      attempts = j.attempts + 1,
      locked_at = now(),
      lock_until = now() + interval '5 minutes',
      updated_at = now()
  FROM candidate
  WHERE j.id = candidate.id
  RETURNING j.id, j.scan_id, j.attempts, j.ingredient_names, j.ingredient_cursor;
$$;

REVOKE ALL ON FUNCTION public.claim_scan_analysis_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scan_analysis_job() TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_scan_analysis_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'net', 'vault'
AS $$
DECLARE
  worker_token text;
BEGIN
  INSERT INTO public.scan_analysis_jobs (scan_id)
  VALUES (NEW.id)
  ON CONFLICT (scan_id) DO UPDATE
    SET status = 'pending',
        next_attempt_at = now(),
        locked_at = NULL,
        lock_until = NULL,
        last_error = NULL,
        updated_at = now();

  BEGIN
    SELECT decrypted_secret
    INTO worker_token
    FROM vault.decrypted_secrets
    WHERE name = 'scan_analysis_worker_token'
    LIMIT 1;

    IF worker_token IS NOT NULL THEN
      PERFORM net.http_post(
        url := 'https://jyeimttsousumvzfpipb.supabase.co/functions/v1/process-scan-analysis',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-scan-worker-token', worker_token
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      );
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Could not trigger scan analysis worker: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_scan_analysis_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_scan_analysis_job() TO service_role;

DROP TRIGGER IF EXISTS enqueue_scan_analysis_job_after_insert ON public.scans;

CREATE TRIGGER enqueue_scan_analysis_job_after_insert
AFTER INSERT ON public.scans
FOR EACH ROW
WHEN (NEW.analysis_status = 'pending')
EXECUTE FUNCTION public.enqueue_scan_analysis_job();

DO $schedule$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid
  INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'scan-analysis-worker-minute'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'scan-analysis-worker-minute',
    '* * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://jyeimttsousumvzfpipb.supabase.co/functions/v1/process-scan-analysis',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-scan-worker-token',
          (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'scan_analysis_worker_token'
            LIMIT 1
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      ) AS request_id;
    $cron$
  );
END
$schedule$;
