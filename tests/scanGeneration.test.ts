import { describe, expect, test } from 'vitest'
import {
  beginScanGeneration,
  createScanGeneration,
  invalidateScanGeneration,
  isCurrentScanGeneration,
} from '@/hooks/scanGeneration'

describe('scanner generation guard', () => {
  test('invalidates work from an older scanner session', () => {
    const generation = createScanGeneration()

    const firstToken = beginScanGeneration(generation)
    expect(isCurrentScanGeneration(generation, firstToken)).toBe(true)

    const secondToken = beginScanGeneration(generation)
    expect(isCurrentScanGeneration(generation, firstToken)).toBe(false)
    expect(isCurrentScanGeneration(generation, secondToken)).toBe(true)

    invalidateScanGeneration(generation)
    expect(isCurrentScanGeneration(generation, secondToken)).toBe(false)
  })
})
