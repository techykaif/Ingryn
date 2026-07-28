/**
 * textRegionFilter — confines OCR text to the on-screen guide rectangle.
 *
 * The guide box drawn in scanner.tsx is purely visual by default — the
 * camera and ML Kit still see the entire frame. This filters ML Kit's
 * per-block bounding boxes down to just what falls inside that box, so
 * text outside it (a nutrition table above the label, a neighbouring
 * product, background clutter) never reaches detection or analysis.
 *
 * GUIDE_WIDTH_RATIO / GUIDE_HEIGHT_RATIO must stay in sync with the guide
 * rectangle's on-screen size (FRAME_W / FRAME_H in scanner.tsx) — both
 * express the same centered percentage of the frame, just applied to the
 * photo's own pixel dimensions instead of the screen's.
 */

/** Guide box occupies this fraction of the frame, centered. */
export const GUIDE_WIDTH_RATIO = 0.86
export const GUIDE_HEIGHT_RATIO = 0.26

type OcrFrame = { left: number; top: number; width: number; height: number }
type OcrBlock = { text: string; frame?: OcrFrame }

/**
 * Reassembles OCR text using only the blocks whose bounding-box center
 * falls inside the centered guide rectangle.
 *
 * Falls back to the full, unfiltered text if the photo has no usable
 * dimensions, if no blocks carry a frame, or if filtering would leave
 * nothing — a little extra noise beats an empty scan.
 */
export function filterTextToGuideBox(
  blocks: OcrBlock[] | undefined,
  fullText: string,
  photoWidth: number | undefined,
  photoHeight: number | undefined
): string {
  if (!blocks?.length || !photoWidth || !photoHeight) return fullText

  const boxW = photoWidth * GUIDE_WIDTH_RATIO
  const boxH = photoHeight * GUIDE_HEIGHT_RATIO
  const left = (photoWidth - boxW) / 2
  const top = (photoHeight - boxH) / 2
  const right = left + boxW
  const bottom = top + boxH

  const inside = blocks.filter((block) => {
    const f = block.frame
    if (!f) return false
    const cx = f.left + f.width / 2
    const cy = f.top + f.height / 2
    return cx >= left && cx <= right && cy >= top && cy <= bottom
  })

  if (!inside.length) return fullText

  return inside.map((b) => b.text).join('\n')
}