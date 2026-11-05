import type { TextItem } from 'pdfjs-dist/types/src/display/api'

const wordPattern = /[\p{L}\p{M}\p{N}]+/gu

export function foldWord(word: string) {
  return word.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}

export function queryWords(query: string) {
  return [...new Set(Array.from(query.matchAll(wordPattern), match => foldWord(match[0])))]
    .filter(Boolean).slice(0, 12)
}

export function matchRanges(text: string, terms: readonly string[]) {
  if (!terms.length) return []
  return Array.from(text.matchAll(wordPattern)).flatMap(match => {
    const word = foldWord(match[0])
    return terms.some(term => term.length >= 3 ? word.startsWith(term) : word === term)
      ? [{ start: match.index, end: match.index + match[0].length }]
      : []
  })
}

export function contextualSnippet(text: string, terms: readonly string[]) {
  const hit = matchRanges(text, terms)[0]?.start ?? 0
  let start = Math.max(0, hit - 68)
  let end = Math.min(text.length, hit + 120)
  while (start > 0 && /\S/u.test(text[start - 1]) && hit - start < 85) start--
  while (end < text.length && /\S/u.test(text[end]) && end - hit < 145) end++
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

export function isTextItem(item: unknown): item is TextItem {
  return Boolean(item && typeof item === 'object' && 'str' in item)
}

/** PDF.js can split a word into adjacent items when the font changes. */
export function textRuns(items: TextItem[]) {
  let text = ''
  const runs = []
  let previous: TextItem | undefined
  for (const item of items) {
    if (previous && text && item.str && !/\s$/u.test(text) && !/^\s/u.test(item.str)) {
      const fontHeight = Math.abs(item.height || previous.height)
      const lineChanged = Math.abs(item.transform[5] - previous.transform[5]) > fontHeight * 0.35
      const gap = item.transform[4] - previous.transform[4] - previous.width
      if (previous.hasEOL || lineChanged || gap > fontHeight * 0.15) text += ' '
    }
    runs.push({ start: text.length, end: text.length + item.str.length })
    text += item.str
    previous = item
  }
  return { text, runs }
}
