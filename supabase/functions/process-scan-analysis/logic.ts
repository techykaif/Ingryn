export const SCAN_ANALYSIS_CHUNK_SIZE = 20
export const MAX_SCAN_ANALYSIS_RETRIES = 5

export type AnalysisStatus = "processing" | "partial" | "completed"

export function getRetryDelaySeconds(retryCount: number): number {
  const retryNumber = Math.max(1, Math.floor(retryCount))
  return Math.min(600, 30 * (2 ** (retryNumber - 1)))
}

export function shouldFailAfterRetry(retryCount: number): boolean {
  return retryCount >= MAX_SCAN_ANALYSIS_RETRIES
}

export function getAnalysisStatus(
  cursor: number,
  total: number,
  unresolvedCount: number,
): AnalysisStatus {
  if (cursor < total) return "processing"
  return unresolvedCount > 0 ? "partial" : "completed"
}

export function parseIngredientNames(text: string): string[] {
  const cleaned = text
    .replace(/\n/g, ", ")
    .replace(/[^\w\s,.;()\-/]/g, "")
    .replace(/\s+/g, " ")
    .trim()

  const parts: string[] = []
  let depth = 0
  let start = 0

  for (let index = 0; index < cleaned.length; index++) {
    const char = cleaned[index]

    if (char === "(") {
      depth++
      continue
    }

    if (char === ")") {
      depth = Math.max(0, depth - 1)
      continue
    }

    if ((char === "," || char === ";" || char === "\n") && depth === 0) {
      const part = cleaned.slice(start, index).trim()
      if (part.length > 1) parts.push(part)
      start = index + 1
    }
  }

  const lastPart = cleaned.slice(start).trim()
  if (lastPart.length > 1) parts.push(lastPart)

  const seen = new Set<string>()
  return parts
    .map((part) => part.toLowerCase().trim())
    .filter((part) => part.length > 1 && part.length < 2000)
    .filter((part) => {
      if (seen.has(part)) return false
      seen.add(part)
      return true
    })
    .slice(0, 200)
}

export function normalizeCacheKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

export type CachedIngredient = {
  id: string
  name: string
  safety_level: string
}

export function mergeIngredientIds(
  currentIds: string[],
  cache: Map<string, CachedIngredient>,
): string[] {
  const seen = new Set(currentIds)
  const merged = [...currentIds]

  for (const ingredient of cache.values()) {
    if (seen.has(ingredient.id)) continue
    seen.add(ingredient.id)
    merged.push(ingredient.id)
  }

  return merged
}

export function calculateSafetyScore(levels: readonly string[]): number {
  if (levels.length === 0) return 50

  const weights: Record<string, number> = {
    safe: 100,
    caution: 50,
    harmful: 0,
    unknown: 60,
  }

  const total = levels.reduce(
    (sum, level) => sum + (weights[level] ?? weights.unknown),
    0,
  )

  return Math.round(total / levels.length)
}
