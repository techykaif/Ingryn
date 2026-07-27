/**
 * Lightweight fuzzy string matcher using Levenshtein distance.
 * Zero external dependencies — uses an optimised single-row DP approach.
 *
 * Usage:
 *   const matcher = new FuzzyMatcher(COMMON_INGREDIENTS, 0.85)
 *   matcher.match('sugr')  // { matched: true, word: 'sugar', score: 0.8 }
 */

export type MatchResult = {
  matched: boolean
  /** Best-matching dictionary word (empty string if no match) */
  word: string
  /** Similarity score 0–1 */
  score: number
}

export class FuzzyMatcher {
  private readonly dictionary: string[]
  private readonly threshold: number
  /** Index: first char → list of dictionary indices for fast pruning */
  private readonly charIndex: Map<string, number[]>

  /**
   * @param dictionary Array of lowercase words/phrases to match against
   * @param threshold  Minimum similarity (0–1) to count as a match. Default 0.85
   */
  constructor(dictionary: string[], threshold = 0.85) {
    this.dictionary = dictionary
    this.threshold = threshold

    // Build first-character index for fast candidate filtering
    this.charIndex = new Map()
    for (let i = 0; i < dictionary.length; i++) {
      const ch = dictionary[i][0]
      if (!ch) continue
      const list = this.charIndex.get(ch)
      if (list) {
        list.push(i)
      } else {
        this.charIndex.set(ch, [i])
      }
    }
  }

  /**
   * Match a single input string against the dictionary.
   * Returns the best match above threshold, or { matched: false }.
   */
  match(input: string): MatchResult {
    const s = input.toLowerCase().trim()
    if (!s) return { matched: false, word: '', score: 0 }

    // Fast exact check
    if (this.dictionary.indexOf(s) !== -1) {
      return { matched: true, word: s, score: 1 }
    }

    let bestScore = 0
    let bestWord = ''

    // Check candidates starting with the same first char, plus one char off
    const candidates = this.getCandidateIndices(s)

    for (const idx of candidates) {
      const dictWord = this.dictionary[idx]

      // Quick length filter: if lengths differ too much, skip
      const lenDiff = Math.abs(s.length - dictWord.length)
      const maxLen = Math.max(s.length, dictWord.length)
      if (maxLen > 0 && lenDiff / maxLen > 0.35) continue

      const score = this.similarity(s, dictWord)
      if (score > bestScore) {
        bestScore = score
        bestWord = dictWord
      }
    }

    if (bestScore >= this.threshold) {
      return { matched: true, word: bestWord, score: bestScore }
    }
    return { matched: false, word: bestWord, score: bestScore }
  }

  /**
   * Count how many tokens in a text fuzzy-match the dictionary.
   * Splits on commas, semicolons, newlines, then matches each token.
   */
  countMatches(text: string): { matchCount: number; totalTokens: number; matchedWords: string[] } {
    const tokens = text
      .toLowerCase()
      .split(/[,;\n]+/)
      .map(t => t.trim())
      .filter(t => t.length > 1 && t.length < 80)

    let matchCount = 0
    const matchedWords: string[] = []

    for (const token of tokens) {
      const result = this.match(token)
      if (result.matched) {
        matchCount++
        matchedWords.push(result.word)
      }
    }

    return { matchCount, totalTokens: tokens.length, matchedWords }
  }

  /** Get candidate dictionary indices worth checking for a given input. */
  private getCandidateIndices(s: string): number[] {
    const indices = new Set<number>()
    const firstChar = s[0]

    // Same first character
    const sameChar = this.charIndex.get(firstChar)
    if (sameChar) {
      for (const i of sameChar) indices.add(i)
    }

    // Adjacent characters (OCR often misreads first char)
    const adjChars = this.getAdjacentChars(firstChar)
    for (const ch of adjChars) {
      const adj = this.charIndex.get(ch)
      if (adj) {
        for (const i of adj) indices.add(i)
      }
    }

    // If very few candidates, do a full scan
    if (indices.size < 5) {
      for (let i = 0; i < this.dictionary.length; i++) {
        indices.add(i)
      }
    }

    return Array.from(indices)
  }

  /** Characters commonly confused by OCR for a given character. */
  private getAdjacentChars(ch: string): string[] {
    const ocrConfusions: Record<string, string[]> = {
      'o': ['0', 'c', 'e'], '0': ['o', 'c'],
      'l': ['1', 'i', '|'], '1': ['l', 'i'],
      'i': ['l', '1', '!', 'j'], 's': ['5', '$'],
      '5': ['s'], 'b': ['6', 'd'], '6': ['b'],
      'g': ['9', 'q'], '9': ['g', 'q'],
      'z': ['2'], '2': ['z'],
      'e': ['c', 'o'], 'c': ['e', 'o'],
      'u': ['v', 'n'], 'n': ['u', 'm', 'h'],
      'm': ['n', 'rn'], 'h': ['n', 'b'],
      'a': ['e', 'o'], 'd': ['b', 'cl'],
      'p': ['q', 'b'], 'q': ['p', 'g'],
      'w': ['vv'], 'r': ['n'],
      't': ['f', '+'], 'f': ['t'],
    }
    return ocrConfusions[ch] || []
  }

  /**
   * Similarity score between two strings (0–1) based on Levenshtein distance.
   * Uses a single-row DP approach for O(min(m,n)) memory.
   */
  private similarity(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length)
    if (maxLen === 0) return 1
    const dist = this.levenshtein(a, b)
    return 1 - dist / maxLen
  }

  /** Levenshtein distance — single-row DP, O(min(m,n)) space. */
  private levenshtein(a: string, b: string): number {
    // Ensure a is the shorter string for memory efficiency
    if (a.length > b.length) {
      const tmp = a; a = b; b = tmp
    }
    const m = a.length
    const n = b.length

    // prev = previous row, curr = current row
    let prev = new Array(m + 1)
    let curr = new Array(m + 1)

    for (let j = 0; j <= m; j++) prev[j] = j

    for (let i = 1; i <= n; i++) {
      curr[0] = i
      for (let j = 1; j <= m; j++) {
        const cost = a[j - 1] === b[i - 1] ? 0 : 1
        curr[j] = Math.min(
          prev[j] + 1,      // deletion
          curr[j - 1] + 1,  // insertion
          prev[j - 1] + cost // substitution
        )
      }
      // Swap rows
      const tmp = prev; prev = curr; curr = tmp
    }

    return prev[m]
  }
}
