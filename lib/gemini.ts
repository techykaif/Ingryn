import { supabase } from './supabase'
import { FunctionsHttpError } from '@supabase/supabase-js'
import type { DietaryPreferences } from '@/store'

export type IngredientAnalysis = {
  id?: string
  name: string
  aliases: string[]
  category: string
  description: string
  safety_level: 'safe' | 'caution' | 'harmful' | 'unknown'
  health_concerns: string[]
  country_status?: Record<string, string>
  personal_flag?: string | null
}



export async function analyzeIngredients(
  ingredientText: string,
  _preferences?: DietaryPreferences
): Promise<IngredientAnalysis[]> {
  const { data, error } = await supabase.functions.invoke('analyze-ingredients', {
    body: { ingredientText },
  })

  if (error) {
    let message = error.message || 'Could not reach the analysis service.'

    // Unwrap the actual error body the edge function sent back
    // (429 / quota / config messages all live here, not on error.message)
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json()
        if (body?.error) message = body.error
      } catch {
        // body wasn't JSON — fall back to the generic message
      }
    }
    throw new Error(message)
  }

  if (!Array.isArray(data)) {
    throw new Error('Gemini returned unexpected format')
  }

  return data as IngredientAnalysis[]
}