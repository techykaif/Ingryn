export type SafetyLevel = 'safe' | 'caution' | 'harmful' | 'unknown'

export const SAFETY_WEIGHTS: Record<SafetyLevel, number> = {
  safe: 100,
  caution: 50,
  harmful: 0,
  unknown: 60,
}

export function getSafetyWeight(level: string): number {
  return SAFETY_WEIGHTS[level as SafetyLevel] ?? SAFETY_WEIGHTS.unknown
}

export function calculateSafetyScore(levels: readonly string[]): number {
  if (levels.length === 0) return 50

  const total = levels.reduce((sum, level) => sum + getSafetyWeight(level), 0)
  return Math.round(total / levels.length)
}

export function appendNewIngredientResults(
  currentIds: readonly string[],
  analysis: ReadonlyArray<{ id?: string; safety_level: SafetyLevel }>,
): {
  ingredientIds: string[]
  newSafetyLevels: SafetyLevel[]
} {
  const knownIds = new Set(currentIds)
  const ingredientIds = [...currentIds]
  const newSafetyLevels: SafetyLevel[] = []

  for (const ingredient of analysis) {
    const id = ingredient.id

    if (!id || knownIds.has(id)) continue

    knownIds.add(id)
    ingredientIds.push(id)
    newSafetyLevels.push(ingredient.safety_level)
  }

  return { ingredientIds, newSafetyLevels }
}
