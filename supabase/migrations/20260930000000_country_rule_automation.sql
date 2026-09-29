-- INGRYN country-rule automation foundation.
-- Idempotent: safe to re-apply after the current hosted project changes.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.country_rule_sources (
  country_code text PRIMARY KEY,
  country_name text NOT NULL,
  source_name text NOT NULL,
  source_url text NOT NULL,
  source_type text NOT NULL DEFAULT 'official_reference'
    CHECK (source_type IN ('official_reference','official_database','official_register')),
  enabled boolean NOT NULL DEFAULT true,
  refresh_interval_days integer NOT NULL DEFAULT 7
    CHECK (refresh_interval_days BETWEEN 1 AND 365),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  adapter_key text NOT NULL DEFAULT 'gemini_search_grounded',
  parser_version integer NOT NULL DEFAULT 1,
  last_content_hash text,
  priority integer NOT NULL DEFAULT 100,
  next_attempt_at timestamptz
);

INSERT INTO public.country_rule_sources
  (country_code, country_name, source_name, source_url, source_type, adapter_key, priority)
VALUES
  ('US', 'United States', 'U.S. Food and Drug Administration', 'https://www.fda.gov/food/food-additives-petitions/food-additive-status-list', 'official_reference', 'gemini_search_grounded', 20),
  ('EU', 'European Union', 'European Commission Food Additives Database', 'https://food.ec.europa.eu/food-safety/food-improvement-agents/additives/database_en', 'official_database', 'gemini_search_grounded', 30),
  ('UK', 'United Kingdom', 'Food Standards Agency — Authorised Regulated Food and Feed Products', 'https://data.food.gov.uk/regulated-products/food_authorisations/guidance', 'official_register', 'gemini_search_grounded', 40),
  ('IN', 'India', 'Food Safety and Standards Authority of India', 'https://fssai.gov.in/food-law/regulations/compendium/food-products-standards', 'official_reference', 'gemini_search_grounded', 10),
  ('AU', 'Australia', 'Food Standards Australia New Zealand — Food Standards Code', 'https://www.foodstandards.gov.au/food-standards-code/legislation', 'official_reference', 'gemini_search_grounded', 60),
  ('CA', 'Canada', 'Health Canada — Lists of Permitted Food Additives', 'https://www.canada.ca/en/health-canada/services/food-nutrition/food-safety/food-additives/lists-permitted.html', 'official_database', 'gemini_search_grounded', 50),
  ('JP', 'Japan', 'Consumer Affairs Agency — Food Additives', 'https://www.caa.go.jp/en/policy/standards_evaluation/food_additives_en', 'official_reference', 'gemini_search_grounded', 70),
  ('CN', 'China', 'National Health Commission — GB 2760-2024', 'https://www.nhc.gov.cn/sps/c100088/202403/bda120e678df4a49a8beb90852559d7c.shtml', 'official_database', 'gemini_search_grounded', 80)
ON CONFLICT (country_code) DO UPDATE SET
  country_name = EXCLUDED.country_name,
  source_name = EXCLUDED.source_name,
  source_url = EXCLUDED.source_url,
  source_type = EXCLUDED.source_type,
  adapter_key = EXCLUDED.adapter_key,
  priority = EXCLUDED.priority,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.country_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL REFERENCES public.country_rule_sources(country_code),
  version_number integer NOT NULL,
  source_url text NOT NULL,
  content_hash text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  analyzed_at timestamptz,
  published_at timestamptz,
  state text NOT NULL DEFAULT 'candidate'
    CHECK (state IN ('candidate','published','superseded','failed')),
  change_summary jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, version_number)
);

CREATE INDEX IF NOT EXISTS country_rule_versions_country_state_idx
  ON public.country_rule_versions (country_code, state);

CREATE TABLE IF NOT EXISTS public.ingredient_country_rules (
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  country_code text NOT NULL REFERENCES public.country_rule_sources(country_code),
  status text NOT NULL
    CHECK (status IN ('permitted','permitted_with_limits','banned','under_review','no_data','other')),
  raw_status text,
  source_version_id uuid REFERENCES public.country_rule_versions(id),
  evidence text,
  effective_from date,
  effective_until date,
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ingredient_id, country_code)
);

CREATE INDEX IF NOT EXISTS ingredient_country_rules_country_status_idx
  ON public.ingredient_country_rules (country_code, status);

INSERT INTO public.ingredient_country_rules
  (ingredient_id, country_code, status, raw_status, updated_at)
SELECT
  i.id,
  m.country_code,
  CASE
    WHEN e.value IN ('permitted','permitted_with_limits','banned','under_review','no_data')
      THEN e.value
    ELSE 'other'
  END,
  CASE
    WHEN e.value IN ('permitted','permitted_with_limits','banned','under_review','no_data')
      THEN NULL
    ELSE e.value
  END,
  i.last_updated
FROM public.ingredients i
CROSS JOIN LATERAL jsonb_each_text(COALESCE(i.country_status, '{}'::jsonb)) e(key, value)
JOIN (
  VALUES
    ('US','US'),
    ('EU','EU'),
    ('UK','UK'),
    ('India','IN'),
    ('Australia','AU'),
    ('Canada','CA'),
    ('Japan','JP'),
    ('China','CN')
) AS m(country_name, country_code)
  ON m.country_name = e.key
ON CONFLICT (ingredient_id, country_code) DO UPDATE
SET status = EXCLUDED.status,
    raw_status = EXCLUDED.raw_status,
    updated_at = EXCLUDED.updated_at;

CREATE TABLE IF NOT EXISTS public.country_rule_refresh_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL REFERENCES public.country_rule_sources(country_code),
  trigger_type text NOT NULL DEFAULT 'scheduled'
    CHECK (trigger_type IN ('scheduled','manual','stale')),
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started','unchanged','candidate_created','published','failed','skipped')),
  source_hash text,
  source_version_id uuid REFERENCES public.country_rule_versions(id),
  ingredients_checked integer NOT NULL DEFAULT 0,
  ingredients_changed integer NOT NULL DEFAULT 0,
  citations_checked integer NOT NULL DEFAULT 0,
  citations_valid integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error_message text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS country_rule_refresh_runs_country_created_idx
  ON public.country_rule_refresh_runs (country_code, created_at DESC);

ALTER TABLE public.country_rule_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.country_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_country_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.country_rule_refresh_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read country rule sources" ON public.country_rule_sources;
CREATE POLICY "Authenticated users can read country rule sources"
  ON public.country_rule_sources
  FOR SELECT
  USING ((select auth.role()) = 'authenticated'::text);

DROP POLICY IF EXISTS "Authenticated users can read country rule versions" ON public.country_rule_versions;
CREATE POLICY "Authenticated users can read country rule versions"
  ON public.country_rule_versions
  FOR SELECT
  USING ((select auth.role()) = 'authenticated'::text);

DROP POLICY IF EXISTS "Authenticated users can read ingredient country rules" ON public.ingredient_country_rules;
CREATE POLICY "Authenticated users can read ingredient country rules"
  ON public.ingredient_country_rules
  FOR SELECT
  USING ((select auth.role()) = 'authenticated'::text);

-- Operational refresh runs are server-only by design.

ALTER TABLE public.country_rule_sources
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

CREATE OR REPLACE FUNCTION public.get_country_rule_refresh_token()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault, auth
AS $function$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'country_rule_refresh_token'
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_country_rule_refresh_token() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_country_rule_refresh_token() TO service_role;

-- Generate the private scheduler token once.
SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'country_rule_refresh_token'
  )
  THEN null
  ELSE vault.create_secret(
    encode(gen_random_bytes(32), 'hex'),
    'country_rule_refresh_token',
    'Internal token used by the scheduled INGRYN country-rule refresh job.'
  )::text
END;

DO $$
DECLARE
  existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'country-rule-refresh-daily';

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;

  PERFORM cron.schedule(
    'country-rule-refresh-daily',
    '30 3 * * *',
    $job$
    SELECT net.http_post(
      url := 'https://jyeimttsousumvzfpipb.supabase.co/functions/v1/refresh-country-rules',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-country-refresh-token',
        (SELECT decrypted_secret
         FROM vault.decrypted_secrets
         WHERE name = 'country_rule_refresh_token'
         LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    ) AS request_id;
    $job$
  );
END
$$;
