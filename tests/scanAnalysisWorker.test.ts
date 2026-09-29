import { describe, expect, it } from 'vitest'
import {
  MAX_SCAN_ANALYSIS_RETRIES,
  SCAN_ANALYSIS_CHUNK_SIZE,
  calculateSafetyScore,
  getAnalysisStatus,
  getRetryDelaySeconds,
  mergeIngredientIds,
  parseIngredientNames,
  shouldFailAfterRetry,
} from '@/supabase/functions/process-scan-analysis/logic'

describe('scan analysis worker logic', () => {
  it('uses exponential backoff capped at ten minutes', () => {
    expect(getRetryDelaySeconds(1)).toBe(30)
    expect(getRetryDelaySeconds(2)).toBe(60)
    expect(getRetryDelaySeconds(3)).toBe(120)
    expect(getRetryDelaySeconds(4)).toBe(240)
    expect(getRetryDelaySeconds(5)).toBe(480)
    expect(getRetryDelaySeconds(6)).toBe(600)
  })

  it('fails only after the configured number of consecutive retries', () => {
    expect(shouldFailAfterRetry(MAX_SCAN_ANALYSIS_RETRIES - 1)).toBe(false)
    expect(shouldFailAfterRetry(MAX_SCAN_ANALYSIS_RETRIES)).toBe(true)
  })

  it('does not exhaust retries while a long scan advances successfully', () => {
    const total = 200
    let cursor = 0
    let consecutiveFailures = 0
    let chunks = 0

    while (cursor < total) {
      cursor += Math.min(SCAN_ANALYSIS_CHUNK_SIZE, total - cursor)
      consecutiveFailures = 0
      chunks += 1
    }

    expect(chunks).toBe(10)
    expect(cursor).toBe(total)
    expect(shouldFailAfterRetry(consecutiveFailures)).toBe(false)
    expect(getAnalysisStatus(cursor, total, 0)).toBe('completed')
  })

  it('marks a fully processed scan partial when some ingredients remain unresolved', () => {
    expect(getAnalysisStatus(20, 20, 2)).toBe('partial')
  })

  it('keeps parenthetical commas inside one ingredient', () => {
    expect(
      parseIngredientNames(
        'calcium caseinate (milk, sugar, potassium citrate), sodium citrate, soy lecithin',
      ),
    ).toEqual([
      'calcium caseinate (milk, sugar, potassium citrate)',
      'sodium citrate',
      'soy lecithin',
    ])
  })

  it('merges cached ingredient ids without duplicates', () => {
    const cache = new Map([
      ['sugar', { id: 'sugar-id', name: 'sugar', safety_level: 'safe' }],
      ['salt', { id: 'salt-id', name: 'salt', safety_level: 'caution' }],
    ])

    expect(mergeIngredientIds(['sugar-id'], cache)).toEqual([
      'sugar-id',
      'salt-id',
    ])
  })

  it('keeps score calculation aligned with the client helper', () => {
    expect(calculateSafetyScore(['safe', 'caution', 'harmful', 'unknown'])).toBe(53)
  })
})
