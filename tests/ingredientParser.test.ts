import { describe, expect, test } from 'vitest'
import { splitIngredientText } from '@/lib/ingredientParser'

describe('App ingredient parsing', () => {
  test('preserves commas inside parenthetical qualifiers', () => {
    expect(splitIngredientText(
      'WATER, CALCIUM CASEINATE (MILK, SUGAR AND LESS THAN 2% OF SODIUM CASEINATE, POTASSIUM CITRATE), SOY LECITHIN'
    )).toEqual([
      'WATER',
      'CALCIUM CASEINATE (MILK, SUGAR AND LESS THAN 2% OF SODIUM CASEINATE, POTASSIUM CITRATE)',
      'SOY LECITHIN',
    ])
  })

  test('supports semicolon and newline separators outside qualifiers', () => {
    expect(splitIngredientText(
      'WATER; SOY LECITHIN\nCALCIUM CASEINATE (MILK, SUGAR, POTASSIUM CITRATE)'
    )).toEqual([
      'WATER',
      'SOY LECITHIN',
      'CALCIUM CASEINATE (MILK, SUGAR, POTASSIUM CITRATE)',
    ])
  })
})
