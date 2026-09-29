-- Usage accounting foundation for future free-tier and RevenueCat enforcement.
-- Scans are counted when created and are not refunded when history is deleted.

CREATE TABLE IF NOT EXISTS public.scan_usage_monthly (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  scan_count integer NOT NULL DEFAULT 0 CHECK (scan_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_start)
);

CREATE INDEX IF NOT EXISTS scan_usage_monthly_period_idx
  ON public.scan_usage_monthly (period_start);

ALTER TABLE public.scan_usage_monthly ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own monthly scan usage"
  ON public.scan_usage_monthly;

CREATE POLICY "Users can read their own monthly scan usage"
  ON public.scan_usage_monthly
  FOR SELECT
  USING ((select auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.record_scan_usage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  usage_month date;
BEGIN
  usage_month := date_trunc('month', COALESCE(NEW.created_at, now()))::date;

  UPDATE public.profiles
  SET scan_count = COALESCE(scan_count, 0) + 1
  WHERE id = NEW.user_id;

  INSERT INTO public.scan_usage_monthly (
    user_id,
    period_start,
    scan_count,
    updated_at
  )
  VALUES (
    NEW.user_id,
    usage_month,
    1,
    now()
  )
  ON CONFLICT (user_id, period_start)
  DO UPDATE SET
    scan_count = public.scan_usage_monthly.scan_count + 1,
    updated_at = now();

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS record_scan_usage_after_insert
  ON public.scans;

CREATE TRIGGER record_scan_usage_after_insert
  AFTER INSERT ON public.scans
  FOR EACH ROW
  EXECUTE FUNCTION public.record_scan_usage();

-- Server-only AI spend telemetry. This is deliberately not user-readable.
CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  gemini_requests integer NOT NULL DEFAULT 0 CHECK (gemini_requests >= 0),
  gemini_prompt_tokens bigint NOT NULL DEFAULT 0 CHECK (gemini_prompt_tokens >= 0),
  gemini_output_tokens bigint NOT NULL DEFAULT 0 CHECK (gemini_output_tokens >= 0),
  unknown_ingredients integer NOT NULL DEFAULT 0 CHECK (unknown_ingredients >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS ai_usage_daily_date_idx
  ON public.ai_usage_daily (usage_date);

ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;

 
CREATE OR REPLACE FUNCTION public.record_gemini_usage(
  p_user_id uuid,
  p_unknown_ingredient_count integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.ai_usage_daily (
    user_id,
    usage_date,
    gemini_requests,
    unknown_ingredients,
    updated_at
  )
  VALUES (
    p_user_id,
    (now() AT TIME ZONE 'UTC')::date,
    1,
    GREATEST(COALESCE(p_unknown_ingredient_count, 0), 0),
    now()
  )
  ON CONFLICT (user_id, usage_date)
  DO UPDATE SET
    gemini_requests = public.ai_usage_daily.gemini_requests + 1,
    unknown_ingredients =
      public.ai_usage_daily.unknown_ingredients +
      GREATEST(COALESCE(EXCLUDED.unknown_ingredients, 0), 0),
    updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.record_gemini_usage(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_gemini_usage(uuid, integer) TO service_role;
