/**
 * textRegionFilter — confines OCR text to the on-screen guide rectangle.
 *
 * Camera OCR is intentionally strict: when a guide box is supplied, only
 * OCR blocks whose geometry intersects the guide are allowed through.
 * We must never fall back to the full OCR result because that can inject
 * browser/UI text, nutrition tables, or nearby product text into the scan.
 *
 * NOTE: GUIDE_WIDTH_RATIO / GUIDE_HEIGHT_RATIO currently describe the
 * centered guide rectangle. Camera/photo coordinate mapping is handled by
 * the caller's dimensions; this module only performs the region gate.
 */

/** Guide box occupies this fraction of the frame, centered. */
export const GUIDE_WIDTH_RATIO = 0.86
export const GUIDE_HEIGHT_RATIO = 0.26

type OcrFrame = { left: number; top: number; width: number; height: number }
type OcrBlock = { text: string; frame?: OcrFrame }

/**
 * Returns OCR text that intersects the centered guide rectangle.
 *
 * Camera safety rule:
 * - If OCR blocks and usable frames exist, ONLY matching blocks are returned.
 * - If framed blocks exist but none intersects the guide, return an empty string.
 * - If no block has a usable frame, return an empty string because there is
 *   no reliable way to prove that the text belongs inside the guide.
 *
 * This deliberately does not fall back to fullText. The scanner should reject
 * an uncertain frame rather than analyze text known to be outside its target.
 */
export function filterTextToGuideBox(
  blocks: OcrBlock[] | undefined,
  _fullText: string,
  photoWidth: number | undefined,
  photoHeight: number | undefined
): string {
  if (!blocks?.length || !photoWidth || !photoHeight) return ''

  const boxW = photoWidth * GUIDE_WIDTH_RATIO
  const boxH = photoHeight * GUIDE_HEIGHT_RATIO
  const left = (photoWidth - boxW) / 2
  const top = (photoHeight - boxH) / 2
  const right = left + boxW
  const bottom = top + boxH

  const framedBlocks = blocks.filter((block) => {
    const f = block.frame
    return !!f && f.width > 0 && f.height > 0
  })

  if (!framedBlocks.length) return ''

  const inside = framedBlocks.filter((block) => {
    const f = block.frame!
    const blockRight = f.left + f.width
    const blockBottom = f.top + f.height

    // Use intersection rather than center-point containment so a text line
    // that straddles the guide boundary is not discarded just because its
    // center falls a few pixels outside.
    const overlaps =
      f.left < right &&
      blockRight > left &&
      f.top < bottom &&
      blockBottom > top

    return overlaps
  })

  // Preserve natural reading order instead of depending on ML Kit's block
  // return order.
  inside.sort((a, b) => {
    const ay = a.frame!.top
    const by = b.frame!.top
    if (Math.abs(ay - by) > Math.max(a.frame!.height, b.frame!.height) * 0.5) {
      return ay - by
    }
    return a.frame!.left - b.frame!.left
  })

  return inside
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n')
}
