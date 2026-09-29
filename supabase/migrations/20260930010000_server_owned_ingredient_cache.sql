-- Server-owned ingredient cache hardening.
-- The shared ingredient catalog must not be writable by authenticated clients.

DROP POLICY IF EXISTS "Anyone authenticated can insert ingredients"
  ON public.ingredients;

DROP POLICY IF EXISTS "Anyone authenticated can update ingredients"
  ON public.ingredients;

CREATE OR REPLACE FUNCTION public.seed_ingredient_country_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.ingredient_country_rules
    (ingredient_id, country_code, status, updated_at)
  SELECT
    NEW.id,
    country_code,
    'no_data',
    now()
  FROM public.country_rule_sources
  WHERE enabled = true
  ON CONFLICT (ingredient_id, country_code) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS seed_ingredient_country_rules_after_insert
  ON public.ingredients;

CREATE TRIGGER seed_ingredient_country_rules_after_insert
  AFTER INSERT ON public.ingredients
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_ingredient_country_rules();

CREATE INDEX IF NOT EXISTS country_rule_refresh_runs_source_version_id_idx
  ON public.country_rule_refresh_runs (source_version_id);

CREATE INDEX IF NOT EXISTS ingredient_country_rules_source_version_id_idx
  ON public.ingredient_country_rules (source_version_id);
