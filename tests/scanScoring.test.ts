import { describe, expect, it } from 'vitest'
import {
  appendNewIngredientResults,
  calculateSafetyScore,
  getSafetyWeight,
} from '@/lib/scanScoring'

describe('scan scoring helpers', () => {
  it('keeps the default score for an empty ingredient set', () => {
    expect(calculateSafetyScore([])).toBe(50)
  })

  it('matches a full recompute when safety levels are accumulated incrementally', () => {
    const initial = ['safe', 'caution']
    const next = ['harmful', 'unknown']

    const initialTotal = initial.reduce((sum, level) => sum + getSafetyWeight(level), 0)
    const nextTotal = next.reduce((sum, level) => sum + getSafetyWeight(level), 0)

    const incrementalScore = Math.round(
      (initialTotal + nextTotal) / (initial.length + next.length),
    )

    expect(incrementalScore).toBe(calculateSafetyScore([...initial, ...next]))
  })

  it('appends only previously unseen ingredient ids and returns their levels', () => {
    const result = appendNewIngredientResults(
      ['cached-id', 'existing-id'],
      [
        { id: 'new-id', safety_level: 'harmful' },
        { id: 'existing-id', safety_level: 'safe' },
        { id: 'new-id', safety_level: 'caution' },
        { id: undefined, safety_level: 'unknown' },
      ],
    )

    expect(result).toEqual({
      ingredientIds: ['cached-id', 'existing-id', 'new-id'],
      newSafetyLevels: ['harmful'],
    })
  })
})
