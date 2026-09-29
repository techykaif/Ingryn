import { describe, expect, test } from 'vitest'
import {
  filterAnalysisToSource,
  splitTopLevelIngredients,
} from '@/supabase/functions/analyze-ingredients/grounding'

describe('Gemini ingredient grounding', () => {
  test('keeps commas inside parenthetical ingredient qualifiers', () => {
    const source = splitTopLevelIngredients(
      'WATER, CALCIUM CASEINATE (MILK, SUGAR AND LESS THAN 2% OF SODIUM CASEINATE, POTASSIUM CITRATE), SOY LECITHIN'
    )

    expect(source).toEqual([
      'WATER',
      'CALCIUM CASEINATE (MILK, SUGAR AND LESS THAN 2% OF SODIUM CASEINATE, POTASSIUM CITRATE)',
      'SOY LECITHIN',
    ])
  })

  test('rejects invented component names while accepting the complete source ingredient', () => {
    const source = [
      'SODIUM CITRATE',
      'CALCIUM CASEINATE (MILK, SUGAR, POTASSIUM CITRATE)',
      'SOY LECITHIN',
    ]

    const analysis = [
      { name: 'sodium' },
      { name: 'sodium citrate' },
      { name: 'calcium caseinate' },
      { name: 'soy' },
      { name: 'soy lecithin' },
    ]

    expect(filterAnalysisToSource(analysis, source)).toEqual([
      { name: 'sodium citrate' },
      { name: 'calcium caseinate' },
      { name: 'soy lecithin' },
    ])
  })
})
