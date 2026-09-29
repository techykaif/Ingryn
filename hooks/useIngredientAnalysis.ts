import { supabase } from '@/lib/supabase'
import type { DietaryPreferences } from '@/store'
import { splitIngredientText } from '@/lib/ingredientParser'
import { calculateSafetyScore } from '@/lib/scanScoring'

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

    // The server owns the durable analysis job. The client only needs to
    // decide whether the newly-created scan starts pending or already complete.
    const { cachedIngredients, cachedIds, unknownNames } = await checkCache(ingredientNames)
    const analysisStatus = unknownNames.length > 0 ? 'pending' : 'completed'
    const safetyScore = calculateSafetyScore(
      cachedIngredients.map((ingredient) => ingredient.safety_level),
    )

    const scanId = await saveScan({
      userId,
      text,
      safetyScore,
      ingredientIds: cachedIds,
      analysisStatus,
    })

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
  analysisStatus: 'pending' | 'completed'
}): Promise<string> {
  const { data: scan, error } = await supabase
    .from('scans')
    .insert({
      user_id: userId,
      raw_ocr_text: text,
      safety_score: safetyScore,
      ingredient_ids: ingredientIds,
      ingredient_count: ingredientIds.length,
      analysis_status: analysisStatus,
      label: null,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return scan.id
}

