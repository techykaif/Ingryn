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
export type GuideViewport = {
  width: number
  height: number
}

/**
 * Map the centered on-screen guide into captured-photo coordinates.
 *
 * CameraView uses a fill preview by default. When the photo and viewport have
 * different aspect ratios, the preview is scaled until it covers the viewport
 * and the excess is cropped from the center. The guide must therefore be
 * transformed through that same scale + crop instead of applying the guide
 * percentages directly to the photo.
 */
function getGuidePhotoRect(
  photoWidth: number,
  photoHeight: number,
  viewportWidth: number,
  viewportHeight: number
) {
  const guideWidth = viewportWidth * GUIDE_WIDTH_RATIO
  const guideHeight = viewportHeight * GUIDE_HEIGHT_RATIO
  const guideLeft = (viewportWidth - guideWidth) / 2
  const guideTop = (viewportHeight - guideHeight) / 2

  const scale = Math.max(
    viewportWidth / photoWidth,
    viewportHeight / photoHeight
  )

  const displayedWidth = photoWidth * scale
  const displayedHeight = photoHeight * scale
  const cropX = (displayedWidth - viewportWidth) / 2
  const cropY = (displayedHeight - viewportHeight) / 2

  const left = Math.max(0, (guideLeft + cropX) / scale)
  const top = Math.max(0, (guideTop + cropY) / scale)
  const right = Math.min(photoWidth, (guideLeft + guideWidth + cropX) / scale)
  const bottom = Math.min(photoHeight, (guideTop + guideHeight + cropY) / scale)

  return { left, top, right, bottom }
}

export function filterTextToGuideBox(
  blocks: OcrBlock[] | undefined,
  _fullText: string,
  photoWidth: number | undefined,
  photoHeight: number | undefined,
  viewport?: GuideViewport
): string {
  if (
    !blocks?.length ||
    !photoWidth ||
    !photoHeight ||
    !viewport?.width ||
    !viewport?.height
  ) return ''

  const { left, top, right, bottom } = getGuidePhotoRect(
    photoWidth,
    photoHeight,
    viewport.width,
    viewport.height
  )

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
