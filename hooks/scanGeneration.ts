export type ScanGeneration = {
  value: number
}

/** Create mutable generation state for a scanner session. */
export function createScanGeneration(): ScanGeneration {
  return { value: 0 }
}

/** Start a new scanner session and return its token. */
export function beginScanGeneration(generation: ScanGeneration): number {
  generation.value += 1
  return generation.value
}

/** Invalidate all in-flight work from the current scanner session. */
export function invalidateScanGeneration(generation: ScanGeneration): number {
  generation.value += 1
  return generation.value
}

/** True only when a token still belongs to the active scanner session. */
export function isCurrentScanGeneration(
  generation: ScanGeneration,
  token: number,
): boolean {
  return generation.value === token
}
