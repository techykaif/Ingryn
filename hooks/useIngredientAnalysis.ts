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
    const chunkSize = 5 // Process 5 ingredients at a time
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
    .filter(s => s.length > 1 && s.length < 100)
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

// Save new ingredients returned by Gemini
async function saveIngredients(analysis: IngredientAnalysis[]): Promise<string[]> {
  // NOTE: personal_flag is intentionally NOT included here. This ingredient
  // record is cached globally and shared across all users, so any flag Gemini
  // returns is only valid for whichever user's preferences triggered this
  // particular analysis. Persisting it would leak that user's health context
  // to every other user who later hits the cache for this ingredient.
  // Personal relevance is computed per-viewer, client-side, in getPersonalFlag()
  // on the results screen instead.
  const normalizedIngredients = analysis
    .map(ingredient => ({
      name: ingredient.name.toLowerCase().trim(),
      aliases: ingredient.aliases || [],
      category: ingredient.category || 'Unknown',
      description: ingredient.description || '',
      safety_level: ingredient.safety_level || 'unknown',
      health_concerns: ingredient.health_concerns || [],
      country_status: ingredient.country_status || {},
    }))
    .filter(item => item.name.length > 0)

  if (normalizedIngredients.length === 0) return []

  const names = normalizedIngredients.map(item => item.name)
  const { data: existing } = await supabase
    .from('ingredients')
    .select('id, name')
    .in('name', names)

  const existingByName = new Map<string, string>((existing || []).map(row => [row.name, row.id]))
  const insertPayload = normalizedIngredients.filter(item => !existingByName.has(item.name))

  if (insertPayload.length > 0) {
    const { data: insertedRows, error: insertError } = await supabase
      .from('ingredients')
      .upsert(insertPayload.map(item => ({
        name: item.name,
        aliases: item.aliases,
        category: item.category,
        description: item.description,
        safety_level: item.safety_level,
        health_concerns: item.health_concerns,
        country_status: item.country_status,
      })), { onConflict: 'name', ignoreDuplicates: true })
      .select('id, name')

    if (insertError) {
      throw insertError
    }

    for (const row of insertedRows || []) {
      existingByName.set(row.name, row.id)
    }

    // ignoreDuplicates means a row skipped due to a concurrent insert won't
    // come back from .select() above — pick up its id with one more lookup
    const stillMissing = insertPayload
      .map(item => item.name)
      .filter(name => !existingByName.has(name))

    if (stillMissing.length > 0) {
      const { data: raceExisting } = await supabase
        .from('ingredients')
        .select('id, name')
        .in('name', stillMissing)
      for (const row of raceExisting || []) {
        existingByName.set(row.name, row.id)
      }
    }
  }

  return normalizedIngredients
    .map(item => existingByName.get(item.name))
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