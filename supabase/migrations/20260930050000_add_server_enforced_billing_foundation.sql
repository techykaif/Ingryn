-- Server-enforced monetization foundation.
-- Enforcement is disabled by default so current product behavior is unchanged.

CREATE TABLE IF NOT EXISTS public.billing_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enforcement_enabled boolean NOT NULL DEFAULT false,
  free_monthly_scan_limit integer,
  max_gemini_requests_per_day integer,
  emergency_ai_disabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.billing_config (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.billing_config ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_entitlements (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  entitlement_key text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  source_event_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider, entitlement_key),
  UNIQUE (provider, source_event_id)
);

CREATE INDEX IF NOT EXISTS user_entitlements_active_idx
  ON public.user_entitlements (user_id, active, expires_at);

ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enforce_scan_allowance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  config_row public.billing_config%ROWTYPE;
  current_usage integer := 0;
  is_premium boolean := false;
BEGIN
  SELECT *
  INTO config_row
  FROM public.billing_config
  WHERE singleton = true;

  IF NOT COALESCE(config_row.enforcement_enabled, false) THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_entitlements e
    WHERE e.user_id = NEW.user_id
      AND e.active = true
      AND (e.expires_at IS NULL OR e.expires_at > now())
  )
  INTO is_premium;

  IF is_premium THEN
    RETURN NEW;
  END IF;

  IF config_row.free_monthly_scan_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(u.scan_count, 0)
  INTO current_usage
  FROM public.scan_usage_monthly u
  WHERE u.user_id = NEW.user_id
    AND u.period_start = date_trunc('month', COALESCE(NEW.created_at, now()))::date;

  IF current_usage >= config_row.free_monthly_scan_limit THEN
    RAISE EXCEPTION 'FREE_SCAN_LIMIT_REACHED';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_scan_allowance_before_insert
  ON public.scans;

CREATE TRIGGER enforce_scan_allowance_before_insert
  BEFORE INSERT ON public.scans
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_scan_allowance();

-- Service-only accessor for operational configuration.
CREATE OR REPLACE FUNCTION public.get_billing_config()
RETURNS public.billing_config
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT *
  FROM public.billing_config
  WHERE singleton = true;
$function$;

REVOKE ALL ON FUNCTION public.get_billing_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_billing_config() TO service_role;

CREATE OR REPLACE FUNCTION public.get_ai_usage_for_user(
  p_user_id uuid,
  p_usage_date date DEFAULT (now() AT TIME ZONE 'UTC')::date
)
RETURNS public.ai_usage_daily
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT *
  FROM public.ai_usage_daily
  WHERE user_id = p_user_id
    AND usage_date = p_usage_date;
$function$;

REVOKE ALL ON FUNCTION public.get_ai_usage_for_user(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_usage_for_user(uuid, date) TO service_role;
