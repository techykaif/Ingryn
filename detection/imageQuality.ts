/**
 * Image Quality Evaluator
 *
 * Infers image quality from OCR output characteristics.
 * We don't have direct access to pixel data during ML Kit on-device OCR,
 * so quality is assessed from the recognized text properties.
 */

export type QualityResult = {
  /** Whether the image quality is acceptable for detection */
  isAcceptable: boolean
  /** Quality score 0–1 */
  score: number
  /** Guidance messages for the user */
  issues: string[]
}

/**
 * Evaluate the quality of an OCR result based on text characteristics.
 *
 * @param text     Full OCR text output
 * @param blocks   Number of text blocks detected by ML Kit (if available)
 */
export function evaluateTextQuality(
  text: string,
  blocks?: number
): QualityResult {
  const issues: string[] = []
  let score = 1.0

  const trimmed = text.trim()
  const charCount = trimmed.length
  const lines = trimmed.split('\n').filter(l => l.trim().length > 0)
  const lineCount = lines.length
  const words = trimmed.split(/\s+/).filter(w => w.length > 0)
  const wordCount = words.length

  // ── No text at all ──
  if (charCount === 0) {
    return {
      isAcceptable: false,
      score: 0,
      issues: ['No readable text detected.'],
    }
  }

  // ── Very little text ──
  if (charCount < 15) {
    score -= 0.5
    issues.push('Move closer.')
  }

  // ── Very few words (likely blurry or too far) ──
  if (wordCount < 3) {
    score -= 0.3
    issues.push('Hold camera steady.')
  }

  // ── Gibberish detection: high ratio of very short words suggests blur ──
  const shortWords = words.filter(w => w.length <= 1).length
  const shortRatio = wordCount > 0 ? shortWords / wordCount : 0
  if (shortRatio > 0.5 && wordCount > 3) {
    score -= 0.3
    issues.push('Hold camera steady.')
  }

  // ── Lots of special characters / numbers mixed in suggests poor focus ──
  const alphaChars = trimmed.replace(/[^a-zA-Z]/g, '').length
  const alphaRatio = charCount > 0 ? alphaChars / charCount : 0
  if (alphaRatio < 0.3 && charCount > 10) {
    score -= 0.2
    issues.push('Increase lighting.')
  }

  // ── Very long average word length might mean spacing issues ──
  const avgWordLen = wordCount > 0
    ? words.reduce((sum, w) => sum + w.length, 0) / wordCount
    : 0
  if (avgWordLen > 20 && wordCount > 2) {
    score -= 0.15
    // Text is running together — possible focus issue
    issues.push('Move slightly further from the label.')
  }

  // ── Good signals that boost score ──
  if (lineCount >= 3 && wordCount >= 8) {
    score = Math.min(score + 0.1, 1.0)
  }
  if (blocks && blocks >= 2) {
    score = Math.min(score + 0.05, 1.0)
  }

  // Clamp
  score = Math.max(0, Math.min(1, score))

  return {
    isAcceptable: score >= 0.4 && issues.length <= 1,
    score,
    issues: issues.length > 0 ? issues : [],
  }
}

/**
 * Compute a text density metric (0–1).
 * Higher values mean more text packed into the OCR result,
 * which is characteristic of ingredient lists.
 */
export function textDensityScore(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0

  const lines = trimmed.split('\n').filter(l => l.trim().length > 0)
  const words = trimmed.split(/\s+/).filter(w => w.length > 0)

  // Ingredient lists are typically dense: many words per line
  const avgWordsPerLine = lines.length > 0 ? words.length / lines.length : 0

  // Normalize: 5+ words/line is high density
  const density = Math.min(avgWordsPerLine / 5, 1)

  return Math.round(density * 100) / 100
}
