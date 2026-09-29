import { supabase } from '@/lib/supabase'
import { analyzeIngredients } from '@/lib/gemini'
import { useScanProgressStore, type DietaryPreferences } from '@/store'
import { splitIngredientText } from '@/lib/ingredientParser'
import {
  appendNewIngredientResults,
  calculateSafetyScore,
  getSafetyWeight,
} from '@/lib/scanScoring'

export async function saveAnalysis(
  text: string,
  userId: string,
  preferences?: DietaryPreferences
): Promise<{ scanId: string; error?: string }> {
  try {
    const ingredientNames = parseIngredientNames(text)

    if (ingredientNames.length === 0) {
      throw new Error('No ingredients could be identified')
    }

    // Step 1: Check cache for all ingredients at once. The cache query also
    // returns safety_level, so scoring does not require a second DB request.
    const { cachedIngredients, cachedIds, unknownNames } = await checkCache(ingredientNames)

    // Step 2: Create scan immediately with cached ingredients.
    const safetyScore = calculateSafetyScore(
      cachedIngredients.map((ingredient) => ingredient.safety_level),
    )
    const scanId = await saveScan({ userId, text, safetyScore, ingredientIds: cachedIds })

    // Step 3: Process unknown ingredients progressively in background
    if (unknownNames.length > 0) {
      useScanProgressStore.getState().setActiveScan(scanId, true)
      const cachedTotal = cachedIngredients.reduce(
        (sum, ingredient) => sum + getSafetyWeight(ingredient.safety_level),
        0,
      )

      processUnknownIngredientsInBackground(
        scanId,
        unknownNames,
        cachedIds,
        cachedTotal,
        cachedIngredients.length,
        preferences,
      ).catch(console.error)
    }

    return { scanId }
  } catch (e: any) {
    const raw = e.message || ''
    let message = raw

    if (
      raw.includes('429') ||
      raw.includes('quota') ||
      raw.includes('high demand') ||
      raw.includes('RESOURCE_EXHAUSTED') ||
      raw.includes('overloaded')
    ) {
      message = 'Our AI is a bit busy right now. Please wait a few seconds and try again.'
    } else if (
      raw.includes('Network') ||
      raw.includes('fetch') ||
      raw.includes('Failed to fetch')
    ) {
      message = 'No internet connection. Please check your network and try again.'
    } else if (raw.includes('No ingredients')) {
      message = 'No ingredients found. Try scanning again or type them manually.'
    } else if (raw.includes('API key') || raw.includes('API_KEY')) {
      message = 'Configuration error. Please restart the app.'
    }

    return { scanId: '', error: message }
  }
}

async function processUnknownIngredientsInBackground(
  scanId: string,
  unknownNames: string[],
  currentIds: string[],
  currentTotal: number,
  currentCount: number,
  preferences?: DietaryPreferences,
) {
  try {
    // The Edge Function caps a single AI request at 25 unknown ingredients.
    // Keep a small safety margin while cutting Gemini request count.
    const chunkSize = 20
    for (let i = 0; i < unknownNames.length; i += chunkSize) {
      const chunk = unknownNames.slice(i, i + chunkSize)
      try {
        const analysis = await analyzeIngredients(chunk.join(', '), preferences)
        const merged = appendNewIngredientResults(currentIds, analysis)

        currentIds = merged.ingredientIds
        currentTotal += merged.newSafetyLevels.reduce(
          (sum, level) => sum + getSafetyWeight(level),
          0,
        )
        currentCount += merged.newSafetyLevels.length

        // Gemini already returns safety_level for the newly persisted records,
        // so avoid re-fetching the entire ingredient set after every batch.
        if (merged.newSafetyLevels.length > 0) {
          const safetyScore = Math.round(currentTotal / currentCount)

          await supabase
            .from('scans')
            .update({ ingredient_ids: currentIds, safety_score: safetyScore })
            .eq('id', scanId)
        }
      } catch (e) {
        console.warn('Failed to process chunk', chunk, e)
      }
    }
  } finally {
    useScanProgressStore.getState().setActiveScan(scanId, false)
  }
}

// Split raw text into individual ingredient names
export function parseIngredientNames(text: string): string[] {
  const seen = new Set<string>()

  return splitIngredientText(text)
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 1 && s.length < 2000)
    .filter(name => {
      if (seen.has(name)) return false
      seen.add(name)
      return true
    })
}

// Single Supabase query to check which ingredients are already cached.
// Include safety_level so the initial scan score can be calculated without
// another round trip.
async function checkCache(names: string[]): Promise<{
  cachedIngredients: { id: string; name: string; safety_level: string }[]
  cachedIds: string[]
  unknownNames: string[]
}> {
  const { data: existing, error } = await supabase
    .from('ingredients')
    .select('id, name, safety_level')
    .in('name', names)

  if (error) throw error

  const cachedIngredients = (existing || []) as {
    id: string
    name: string
    safety_level: string
  }[]
  const cachedIds = cachedIngredients.map((row) => row.id)
  const cachedNames = new Set(cachedIngredients.map((row) => row.name))
  const unknownNames = names.filter((name) => !cachedNames.has(name))

  return { cachedIngredients, cachedIds, unknownNames }
}

async function saveScan({
  userId,
  text,
  safetyScore,
  ingredientIds,
}: {
  userId: string
  text: string
  safetyScore: number
  ingredientIds: string[]
}): Promise<string> {
  const { data: scan, error } = await supabase
    .from('scans')
    .insert({
      user_id: userId,
      raw_ocr_text: text,
      safety_score: safetyScore,
      ingredient_ids: ingredientIds,
      label: null,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return scan.id
}

