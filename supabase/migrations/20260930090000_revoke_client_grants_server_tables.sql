-- Server-managed billing, usage, entitlement, and country refresh tables.
-- Keep RLS enabled and remove all direct client table privileges as defense in depth.
REVOKE ALL ON TABLE
  public.ai_usage_daily,
  public.billing_config,
  public.country_rule_refresh_runs,
  public.user_entitlements
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.ai_usage_daily,
  public.billing_config,
  public.country_rule_refresh_runs,
  public.user_entitlements
TO service_role;
