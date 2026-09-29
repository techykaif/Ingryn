import { supabase } from '@/lib/supabase'
import { analyzeIngredients, type IngredientAnalysis } from '@/lib/gemini'
import { useScanProgressStore, type DietaryPreferences } from '@/store'
import { splitIngredientText } from '@/lib/ingredientParser'

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

    // Step 1: Check cache for all ingredients at once
    const { cachedIds, unknownNames } = await checkCache(ingredientNames)

    // Step 2: Create scan immediately with cached ingredients
    const allIngredients = await fetchIngredientsByIds(cachedIds)
    const safetyScore = calculateSafetyScore(allIngredients)
    const scanId = await saveScan({ userId, text, safetyScore, ingredientIds: cachedIds })

    // Step 3: Process unknown ingredients progressively in background
    if (unknownNames.length > 0) {
      useScanProgressStore.getState().setActiveScan(scanId, true)
      processUnknownIngredientsInBackground(scanId, unknownNames, cachedIds, preferences).catch(console.error)
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
  preferences?: DietaryPreferences
) {
  try {
    // The Edge Function caps a single AI request at 25 unknown ingredients.
    // Keep a small safety margin while cutting Gemini request count.
    const chunkSize = 20
    for (let i = 0; i < unknownNames.length; i += chunkSize) {
      const chunk = unknownNames.slice(i, i + chunkSize)
      try {
        const analysis = await analyzeIngredients(chunk.join(', '), preferences)
        const newIds = await saveIngredients(analysis)
        
        currentIds = [...currentIds, ...newIds]
        const allIngredients = await fetchIngredientsByIds(currentIds)
        const safetyScore = calculateSafetyScore(allIngredients)
        
        await supabase
          .from('scans')
          .update({ ingredient_ids: currentIds, safety_score: safetyScore })
          .eq('id', scanId)
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

// Single Supabase query to check which ingredients are already cached
async function checkCache(names: string[]): Promise<{
  cachedIds: string[]
  unknownNames: string[]
}> {
  const { data: existing, error } = await supabase
    .from('ingredients')
    .select('id, name')
    .in('name', names)

  if (error) throw error

  const cachedIds: string[] = []
  const cachedNames = new Set<string>()

  for (const row of existing || []) {
    cachedIds.push(row.id)
    cachedNames.add(row.name)
  }

  const unknownNames = names.filter(n => !cachedNames.has(n))

  return { cachedIds, unknownNames }
}

// Fetch ingredients by IDs to calculate safety score
async function fetchIngredientsByIds(
  ids: string[]
): Promise<{ safety_level: string }[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('ingredients')
    .select('safety_level')
    .in('id', ids)
  if (error) throw error
  return (data || []) as { safety_level: string }[]
}

// Gemini now persists unknown ingredients server-side and returns
// their database IDs. The client must never write shared ingredient records.
async function saveIngredients(analysis: IngredientAnalysis[]): Promise<string[]> {
  return analysis
    .map((ingredient) => ingredient.id)
    .filter((id): id is string => Boolean(id))
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

function calculateSafetyScore(ingredients: { safety_level: string }[]): number {
  if (!ingredients.length) return 50
  const weights: Record<string, number> = {
    safe: 100,
    caution: 50,
    harmful: 0,
    unknown: 60,
  }
  const total = ingredients.reduce((sum, i) => {
    return sum + (weights[i.safety_level] ?? 60)
  }, 0)
  return Math.round(total / ingredients.length)
}