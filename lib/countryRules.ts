import { supabase } from '@/lib/supabase'

export type CountryRuleSet = {
  status: Record<string, string>
  rawStatus: Record<string, string>
}

export async function fetchCountryRules(
  ingredientIds: string[],
): Promise<Map<string, CountryRuleSet>> {
  if (ingredientIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('ingredient_country_rules')
    .select('ingredient_id, country_code, status, raw_status')
    .in('ingredient_id', ingredientIds)

  if (error) throw error

  const result = new Map<string, CountryRuleSet>()

  for (const row of data || []) {
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
