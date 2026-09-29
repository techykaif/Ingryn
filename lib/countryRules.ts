import { supabase } from '@/lib/supabase'

export type CountryRuleSet = {
  status: Record<string, string>
  rawStatus: Record<string, string>
}

/**
 * Return only country rules that have been verified against a successfully
 * checked source within that country's configured freshness window.
 *
 * Stale/unverified rules are intentionally omitted. Callers fall back to
 * "no_data" rather than presenting an outdated regulatory status.
 */
export async function fetchCountryRules(
  ingredientIds: string[],
): Promise<Map<string, CountryRuleSet>> {
  if (ingredientIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('ingredient_country_rules')
    .select(
      'ingredient_id, country_code, status, raw_status, verified_at, country_rule_sources!inner(enabled, last_success_at, refresh_interval_days)'
    )
    .in('ingredient_id', ingredientIds)

  if (error) throw error

  const now = Date.now()
  const result = new Map<string, CountryRuleSet>()

  for (const row of data || []) {
    const source = Array.isArray(row.country_rule_sources)
      ? row.country_rule_sources[0]
      : row.country_rule_sources

    if (!source?.enabled || !row.verified_at || !source.last_success_at) {
      continue
    }

    const freshnessWindowMs =
      Number(source.refresh_interval_days || 7) *
      24 *
      60 *
      60 *
      1000

    const ruleAge = now - new Date(row.verified_at).getTime()
    const sourceAge = now - new Date(source.last_success_at).getTime()

    if (ruleAge < 0 || sourceAge < 0) {
      continue
    }

    if (ruleAge > freshnessWindowMs || sourceAge > freshnessWindowMs) {
      continue
    }

    const current = result.get(row.ingredient_id) || {
      status: {},
      rawStatus: {},
    }

    current.status[row.country_code] = row.status

    if (row.raw_status) {
      current.rawStatus[row.country_code] = row.raw_status
    }

    result.set(row.ingredient_id, current)
  }

  return result
}
