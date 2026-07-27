/**
 * Ingredient section trigger keywords.
 * These words typically appear as headers or labels on ingredient lists.
 * Each keyword has a weight (0–1) indicating signal strength.
 */

export type KeywordEntry = {
  keyword: string
  weight: number
}

/** High-confidence trigger words (section headers / labels) */
export const INGREDIENT_TRIGGER_KEYWORDS: KeywordEntry[] = [
  // Direct headers
  { keyword: 'ingredients', weight: 1.0 },
  { keyword: 'ingredient', weight: 0.9 },
  { keyword: 'composition', weight: 0.8 },
  { keyword: 'active ingredients', weight: 0.95 },
  { keyword: 'inactive ingredients', weight: 0.95 },
  { keyword: 'other ingredients', weight: 0.9 },
  // Contextual
  { keyword: 'contains', weight: 0.7 },
  { keyword: 'made with', weight: 0.7 },
  { keyword: 'made from', weight: 0.7 },
  { keyword: 'contents', weight: 0.6 },
  { keyword: 'constituents', weight: 0.7 },
  { keyword: 'formulation', weight: 0.7 },
  { keyword: 'each serving contains', weight: 0.8 },
  // Allergen-related (often near ingredient lists)
  { keyword: 'allergen', weight: 0.5 },
  { keyword: 'allergens', weight: 0.5 },
  { keyword: 'may contain', weight: 0.6 },
  { keyword: 'allergy advice', weight: 0.5 },
  { keyword: 'allergy information', weight: 0.5 },
]

/**
 * Regex patterns that strongly indicate ingredient-list formatting.
 * Example: "Ingredients: sugar, salt, ..."
 */
export const INGREDIENT_STRUCTURE_PATTERNS: RegExp[] = [
  /ingredients?\s*:/i,
  /contains?\s*:/i,
  /composition\s*:/i,
  /made\s+(?:with|from)\s*:/i,
]
