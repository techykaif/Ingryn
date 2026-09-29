import { describe, expect, test } from 'vitest'
import { DetectionEngine } from '@/detection/DetectionEngine'
import { filterTextToGuideBox } from '@/detection/textRegionFilter'

describe('scanner detection', () => {
  test('does not classify compound ingredient names as Nutrition Facts', () => {
    const engine = new DetectionEngine()

    const result = engine.detect(
      'INGREDIENTS: WATER, CORN SYRUP, CANOLA OIL, CALCIUM CASEINATE (MILK, SUGAR AND LESS THAN 2% OF SODIUM CASEINATE, POTASSIUM CITRATE, DISTILLED MONOGLYCERIDES, MAGNESIUM CHLORIDE, POTASSIUM PHOSPHATE, CELLULOSE GEL, SODIUM ASCORBATE, SODIUM CITRATE, CHOLINE CHLORIDE, CITRIC ACID, SOY LECITHIN, NATURAL AND ARTIFICIAL FLAVOR, ALPHA-TOCOPHERYL ACETATE, MAGNESIUM OXIDE, MALTODEXTRIN, CALCIUM PHOSPHATE, SALT, CELLULOSE GUM, FERROUS SULFATE, ZINC SULFATE, NIACINAMIDE, VITAMIN A PALMITATE, CALCIUM PANTOTHENATE, COPPER GLUCONATE, MANGANESE SULFATE, VITAMIN D3, PYRIDOXINE HYDROCHLORIDE, THIAMINE HYDROCHLORIDE, RIBOFLAVIN, FOLIC ACID, CHROMIUM CHLORIDE, BIOTIN, POTASSIUM IODIDE, SODIUM MOLYBDATE, SODIUM SELENITE, VITAMIN K1, VITAMIN B12'
    )

    expect(result.classification).toBe('INGREDIENTS')
    expect(result.classification).not.toBe('NUTRITION')
    expect(result.scores.nutrition).toBe(0)
  })

  test('recognizes a real Nutrition Facts block', () => {
    const engine = new DetectionEngine()

    const result = engine.detect(
      'Nutrition Facts\nServing Size 1 cup\nCalories 100\nTotal Fat 2g\nSodium 100mg\nTotal Carbohydrate 10g'
    )

    expect(result.classification).toBe('NUTRITION')
    expect(result.confidence).toBe(1)
  })
})

describe('guide-box OCR filtering', () => {
  const viewport = { width: 1080, height: 2392 }

  test('keeps only blocks mapped inside the on-screen guide', () => {
    const text = filterTextToGuideBox(
      [
        { text: 'OUTSIDE', frame: { left: 20, top: 100, width: 120, height: 40 } },
        { text: 'INGREDIENTS', frame: { left: 300, top: 900, width: 250, height: 50 } },
        { text: 'NEARBY', frame: { left: 50, top: 900, width: 100, height: 40 } },
      ],
      'OUTSIDE INGREDIENTS NEARBY',
      1080,
      1920,
      viewport
    )

    expect(text).toBe('INGREDIENTS')
  })

  test('rejects uncertain OCR instead of falling back to full text', () => {
    const text = filterTextToGuideBox(
      [
        { text: 'OUTSIDE', frame: { left: 20, top: 100, width: 120, height: 40 } },
      ],
      'OUTSIDE FULL OCR FALLBACK',
      1080,
      1920,
      viewport
    )

    expect(text).toBe('')
  })

  test('rejects blocks without geometry', () => {
    const text = filterTextToGuideBox(
      [{ text: 'INGREDIENTS' }],
      'INGREDIENTS',
      1080,
      1920,
      viewport
    )

    expect(text).toBe('')
  })
})
