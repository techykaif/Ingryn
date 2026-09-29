/**
 * Detection Engine
 *
 * Core classification component. Receives OCR text and determines what
 * the user is scanning: INGREDIENTS, NUTRITION, BARCODE, or UNKNOWN.
 *
 * Completely local — no network requests.
 *
 * Confidence weights:
 *   Ingredient Keywords  30%
 *   Ingredient Matches   40%
 *   OCR Quality          20%
 *   Text Density         10%
 */

import {
  INGREDIENT_TRIGGER_KEYWORDS,
  INGREDIENT_STRUCTURE_PATTERNS,
} from './constants/ingredientKeywords'
import { NUTRITION_KEYWORDS } from './constants/nutritionKeywords'
import { COMMON_INGREDIENTS } from './constants/ingredientDatabase'
import { FuzzyMatcher } from './FuzzyMatcher'
import { evaluateTextQuality, textDensityScore } from './imageQuality'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DetectionClassification =
  | 'INGREDIENTS'
  | 'NUTRITION'
  | 'BARCODE'
  | 'UNKNOWN'

export type DetectionResult = {
  classification: DetectionClassification
  confidence: number
  scores: {
    ingredient: number
    nutrition: number
    barcode: number
  }
  qualityIssues: string[]
  /** Guidance message for the overlay */
  guidanceMessage: string
}

// ── Regex patterns ────────────────────────────────────────────────────────────

/** E-number pattern: E followed by 3-4 digits, optionally a-d suffix */
const E_NUMBER_REGEX = /\b[eE]\d{3,4}[a-d]?\b/g

/** INS code pattern: INS followed by 3-4 digits */
const INS_CODE_REGEX = /\bINS\s?\d{3,4}\b/gi

/** Barcode patterns: long numeric sequences (UPC/EAN) */
const BARCODE_REGEX = /\b\d{8,14}\b/g

/** Comma-separated list pattern (typical ingredient list formatting) */
const COMMA_LIST_REGEX = /\w+\s*,\s*\w+/g

// ── Confidence thresholds ─────────────────────────────────────────────────────

const INGREDIENT_HIGH_THRESHOLD = 0.85
const INGREDIENT_LOW_THRESHOLD = 0.50
const NUTRITION_THRESHOLD = 0.45

/**
 * Nutrient names such as "sodium", "calcium", and "vitamin" are also common
 * inside legitimate ingredient lists. These terms alone must not turn an
 * ingredient list into a Nutrition Facts classification.
 *
 * Strong nutrition signals are section headers, serving context, daily-value
 * labels, calories, or explicit macro labels.
 */
const STRONG_NUTRITION_KEYWORDS = [
  'nutrition facts',
  'nutritional information',
  'nutrition information',
  'nutritional values',
  'supplement facts',
  'calories',
  'serving size',
  'servings per container',
  'amount per serving',
  'daily value',
  '% daily value',
  'percent daily value',
  'total fat',
  'saturated fat',
  'trans fat',
  'cholesterol',
  'total carbohydrate',
  'dietary fiber',
  'dietary fibre',
  'total sugars',
  'added sugars',
  'per 100g',
  'per 100ml',
  'per serving',
  'kcal',
  'kj',
]
const BARCODE_MATCH_COUNT = 1

// ── Weights ───────────────────────────────────────────────────────────────────

const W_KEYWORD = 0.30
const W_INGREDIENT_MATCH = 0.40
const W_QUALITY = 0.20
const W_DENSITY = 0.10

// ── Engine ────────────────────────────────────────────────────────────────────

export class DetectionEngine {
  private readonly fuzzyMatcher: FuzzyMatcher

  constructor() {
    this.fuzzyMatcher = new FuzzyMatcher(COMMON_INGREDIENTS, 0.78)
  }

  /**
   * Analyse OCR text and classify what the user is scanning.
   * This method must remain fast (<100ms) — it runs on every scheduled frame.
   */
  detect(ocrText: string): DetectionResult {
    const text = ocrText.trim()

    if (!text || text.length < 5) {
      return this.buildResult('UNKNOWN', 0, 0, 0, [], 'No readable text detected.')
    }

    const lower = text.toLowerCase()

    // ── Step 1: Barcode check (immediate classification) ──
    const barcodeScore = this.scoreBarcodes(text)
    if (barcodeScore >= BARCODE_MATCH_COUNT) {
      return this.buildResult('BARCODE', 0, 0, 1, [], 'Barcode detected. Please scan the Ingredients list.')
    }

    // ── Step 2: Score each category ──
    const keywordScore = this.scoreIngredientKeywords(lower)
    const ingredientMatchScore = this.scoreIngredientMatches(lower)
    const nutritionScore = this.scoreNutrition(lower)

    // ── Step 3: Image quality and density ──
    const quality = evaluateTextQuality(text)
    const density = textDensityScore(text)

    // ── Step 4: Calculate ingredient confidence before nutrition classification ──
    // This is important because nutrition terms also occur inside ingredient
    // names (e.g. sodium citrate, calcium phosphate, vitamin A palmitate).
    const confidence =
      keywordScore * W_KEYWORD +
      ingredientMatchScore * W_INGREDIENT_MATCH +
      quality.score * W_QUALITY +
      density * W_DENSITY

    const hasIngredientHeader =
      /(?:^|\\b)(?:ingredients?|composition|active ingredients|inactive ingredients|other ingredients)\\s*:/i.test(text)

    const hasStrongNutritionSignal = this.hasStrongNutritionSignal(lower)

    // ── Step 5: Nutrition classification ──
    // A generic nutrient-word count is not enough. An ingredient list with
    // "sodium", "calcium", "magnesium", "vitamin", etc. can otherwise score
    // 100% as nutrition and remain red forever.
    //
    // If an explicit ingredient header is present, require a strong nutrition
    // signal before allowing nutrition classification.
    if (
      nutritionScore >= NUTRITION_THRESHOLD &&
      nutritionScore > confidence &&
      (!hasIngredientHeader || hasStrongNutritionSignal)
    ) {
      return this.buildResult(
        'NUTRITION',
        keywordScore,
        nutritionScore,
        0,
        quality.issues,
        'This looks like the Nutrition Facts table. Please scan the Ingredients section.'
      )
    }

    // ── Step 6: Quality gate ──
    if (!quality.isAcceptable) {
      return this.buildResult(
        'UNKNOWN',
        confidence,
        nutritionScore,
        0,
        quality.issues,
        quality.issues[0] || 'Improve image quality.'
      )
    }

    // ── Step 7: Classify ──
    if (confidence >= INGREDIENT_HIGH_THRESHOLD) {
      return this.buildResult(
        'INGREDIENTS',
        confidence,
        nutritionScore,
        0,
        [],
        'Ingredient list detected!'
      )

    if (confidence >= INGREDIENT_LOW_THRESHOLD) {
      return this.buildResult(
        'UNKNOWN',
        confidence,
        nutritionScore,
        0,
        [],
        'Possible ingredient list. Hold steady...'
      )

    // ── Fallback ──
    let guidance = 'Point at ingredient list'
    if (nutritionScore > 0.2) {
      guidance = 'This looks like the Nutrition Facts table. Please scan the Ingredients section.'
    }
    if (quality.issues.length > 0) {
      guidance = quality.issues[0]
    }

    return this.buildResult('UNKNOWN', confidence, nutritionScore, 0, quality.issues, guidance)
  }

  // ─── Scoring functions ──────────────────────────────────────────────────────
      keywordScore * W_KEYWORD +
      ingredientMatchScore * W_INGREDIENT_MATCH +
      quality.score * W_QUALITY +
      density * W_DENSITY

    // ── Step 6: Quality gate ──
    if (!quality.isAcceptable) {
      return this.buildResult(
        'UNKNOWN',
        confidence,
        nutritionScore,
        0,
        quality.issues,
        quality.issues[0] || 'Improve image quality.'
      )
    }

    // ── Step 7: Classify ──
    if (confidence >= INGREDIENT_HIGH_THRESHOLD) {
      return this.buildResult(
        'INGREDIENTS',
        confidence,
        nutritionScore,
        0,
        [],
        'Ingredient list detected!'
      )
    }

    if (confidence >= INGREDIENT_LOW_THRESHOLD) {
      return this.buildResult(
        'UNKNOWN',
        confidence,
        nutritionScore,
        0,
        [],
        'Possible ingredient list. Hold steady...'
      )
    }

    // ── Fallback ──
    let guidance = 'Point at ingredient list'
    if (nutritionScore > 0.2) {
      guidance = 'This looks like the Nutrition Facts table. Please scan the Ingredients section.'
    }
    if (quality.issues.length > 0) {
      guidance = quality.issues[0]
    }

    return this.buildResult('UNKNOWN', confidence, nutritionScore, 0, quality.issues, guidance)
  }

  // ─── Scoring functions ──────────────────────────────────────────────────────

  /** Score presence of ingredient-section keywords (0–1). */
  private scoreIngredientKeywords(lower: string): number {
    let score = 0
    let maxPossible = 0

    // Check structure patterns (very high signal)
    for (const pattern of INGREDIENT_STRUCTURE_PATTERNS) {
      if (pattern.test(lower)) {
        score += 1.0
        maxPossible += 1.0
        break // One structure match is enough
      }
      maxPossible += 1.0
    }

    // Check trigger keywords
    for (const entry of INGREDIENT_TRIGGER_KEYWORDS) {
      maxPossible += entry.weight
      if (lower.includes(entry.keyword)) {
        score += entry.weight
      }
    }

    // Check comma-separated list pattern (structural signal)
    const commaMatches = lower.match(COMMA_LIST_REGEX)
    if (commaMatches && commaMatches.length >= 3) {
      score += 0.4
    }
    maxPossible += 0.4

    return maxPossible > 0 ? Math.min(score / maxPossible, 1) : 0
  }

  /** Score how many tokens fuzzy-match known ingredients (0–1). */
  private scoreIngredientMatches(lower: string): number {
    // Count E-number and INS code matches
    const eMatches = lower.match(E_NUMBER_REGEX) || []
    const insMatches = lower.match(INS_CODE_REGEX) || []
    const codeMatchCount = eMatches.length + insMatches.length

    // Fuzzy match ingredient names
    const { matchCount, totalTokens } = this.fuzzyMatcher.countMatches(lower)

    const totalMatches = matchCount + codeMatchCount
    const totalItems = Math.max(totalTokens, 1)

    // Ratio of matched items
    const ratio = totalMatches / totalItems

    // Boost if we have absolute high match count
    if (totalMatches >= 5) return Math.min(ratio + 0.2, 1)
    if (totalMatches >= 3) return Math.min(ratio + 0.1, 1)

    return Math.min(ratio, 1)
  }

  /** Whether OCR contains a nutrition-table-specific signal. */
  private hasStrongNutritionSignal(lower: string): boolean {
    return STRONG_NUTRITION_KEYWORDS.some(keyword => lower.includes(keyword))
  }

  /** Score presence of nutrition-related keywords (0–1). */
  private scoreNutrition(lower: string): number {
    let matches = 0
    for (const keyword of NUTRITION_KEYWORDS) {
      if (lower.includes(keyword)) {
        matches++
      }
    }
    // 5+ nutrition keywords is a very strong signal
    if (matches >= 5) return 1
    return Math.min(matches / 5, 1)
  }

  /** Count barcode-like patterns. Returns count. */
  private scoreBarcodes(text: string): number {
    const matches = text.match(BARCODE_REGEX) || []
    // Only count sequences that look like real barcodes (8, 12, 13, or 14 digits)
    return matches.filter(m => {
      const len = m.length
      return len === 8 || len === 12 || len === 13 || len === 14
    }).length
  }

  // ─── Result builder ─────────────────────────────────────────────────────────

  private buildResult(
    classification: DetectionClassification,
    ingredientScore: number,
    nutritionScore: number,
    barcodeScore: number,
    qualityIssues: string[],
    guidanceMessage: string | string[]
  ): DetectionResult {
    const confidence =
      classification === 'INGREDIENTS' ? ingredientScore :
      classification === 'NUTRITION' ? nutritionScore :
      classification === 'BARCODE' ? 1 :
      ingredientScore

    return {
      classification,
      confidence: Math.round(confidence * 100) / 100,
      scores: {
        ingredient: Math.round(ingredientScore * 100) / 100,
        nutrition: Math.round(nutritionScore * 100) / 100,
        barcode: Math.round(barcodeScore * 100) / 100,
      },
      qualityIssues: Array.isArray(qualityIssues) ? qualityIssues : [],
      guidanceMessage: Array.isArray(guidanceMessage) ? guidanceMessage[0] || '' : guidanceMessage,
    }
  }
}
