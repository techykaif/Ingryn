/**
 * Split OCR ingredient text without breaking commas inside parenthetical
 * qualifiers such as "calcium caseinate (milk, sugar, ...)".
 */
export function splitIngredientText(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0

  for (let index = 0; index < text.length; index++) {
    const char = text[index]

    if (char === '(') {
      depth++
      continue
    }

    if (char === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }

    if ((char === ',' || char === ';' || char === '\n') && depth === 0) {
      const part = text.slice(start, index).trim()
      if (part.length > 1) parts.push(part)
      start = index + 1
    }
  }

  const lastPart = text.slice(start).trim()
  if (lastPart.length > 1) parts.push(lastPart)

  return parts
}
