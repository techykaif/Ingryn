-- Keep worker claim attempts separate from retry failures.
--
-- attempts continues to count every claim (useful for diagnosing lease churn
-- and worker restarts). retry_count counts consecutive processing failures and
-- is the value used by the worker's retry ceiling.

ALTER TABLE public.scan_analysis_jobs
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scan_analysis_jobs_retry_count_check'
      AND conrelid = 'public.scan_analysis_jobs'::regclass
  ) THEN
    ALTER TABLE public.scan_analysis_jobs
      ADD CONSTRAINT scan_analysis_jobs_retry_count_check
      CHECK (retry_count >= 0);
  END IF;
END
$$;
