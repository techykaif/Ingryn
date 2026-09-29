export function normalizeIngredientName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Split an ingredient list only on top-level commas.
 *
 * Commas inside parenthetical qualifiers belong to the same ingredient:
 * "calcium caseinate (milk, sugar, potassium citrate)" must remain one item.
 */
export function splitTopLevelIngredients(input: string): string[] {
  const ingredients: string[] = []
  let depth = 0
  let start = 0

  for (let index = 0; index < input.length; index++) {
    const char = input[index]

    if (char === "(") {
      depth++
      continue
    }

    if (char === ")") {
      depth = Math.max(0, depth - 1)
      continue
    }

    if (char === "," && depth === 0) {
      const item = input.slice(start, index).trim()
      if (item.length > 1) ingredients.push(item)
      start = index + 1
    }
  }

  const lastItem = input.slice(start).trim()
  if (lastItem.length > 1) ingredients.push(lastItem)

  return ingredients
}

/**
 * Keep Gemini output grounded in the actual scanner text.
 *
 * Exact matches are preferred. A shortened name is accepted only when it is
 * the leading name of a single source item, such as:
 *   "calcium caseinate" -> "calcium caseinate (milk, ...)"
 *
 * We intentionally reject partial matches like:
 *   "sodium" -> "sodium citrate"
 * because the label contains multiple different sodium compounds and the
 * shorter term is not itself an ingredient on the label.
 */
export function filterAnalysisToSource(
  analysis: unknown[],
  sourceIngredients: string[],
): unknown[] {
  const sources = sourceIngredients
    .map((source) => ({
      raw: source,
      normalized: normalizeIngredientName(source),
    }))
    .filter((source) => source.normalized.length > 1)

  return analysis.filter((item) => {
    if (!item || typeof item !== "object") return false

    const name = typeof (item as { name?: unknown }).name === "string"
      ? (item as { name: string }).name
      : ""
    const normalizedName = normalizeIngredientName(name)
    if (!normalizedName) return false

    const matches = sources.filter((source) => {
      if (source.normalized === normalizedName) return true

      return source.normalized.startsWith(normalizedName + " ")
        && source.raw.trim().toLowerCase().startsWith(name.trim().toLowerCase())
        && /^\s*\(/.test(source.raw.trim().slice(name.trim().length))
    })

    return matches.length === 1
  })
}
