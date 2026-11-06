import type { PdfRect } from './model'

// PDF.js may round the same text bounds differently after zooming.
const minimumFragment = 0.00075

function subtract(rect: PdfRect, covered: PdfRect): PdfRect[] {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const overlapLeft = Math.max(rect.x, covered.x)
  const overlapTop = Math.max(rect.y, covered.y)
  const overlapRight = Math.min(right, covered.x + covered.width)
  const overlapBottom = Math.min(bottom, covered.y + covered.height)
  if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) return [rect]

  return [
    { x: rect.x, y: rect.y, width: rect.width, height: overlapTop - rect.y },
    { x: rect.x, y: overlapBottom, width: rect.width, height: bottom - overlapBottom },
    { x: rect.x, y: overlapTop, width: overlapLeft - rect.x, height: overlapBottom - overlapTop },
    { x: overlapRight, y: overlapTop, width: right - overlapRight, height: overlapBottom - overlapTop },
  ].filter(piece => piece.width > minimumFragment && piece.height > minimumFragment)
}

export function uncoveredHighlightRects(selection: PdfRect[], existing: PdfRect[]): PdfRect[] {
  const uncovered: PdfRect[] = []
  const covered = [...existing]
  for (const rect of selection) {
    let pieces = [rect]
    for (const mark of covered) {
      pieces = pieces.flatMap(piece => subtract(piece, mark))
      if (!pieces.length) break
    }
    uncovered.push(...pieces)
    covered.push(...pieces)
  }
  return uncovered
}
