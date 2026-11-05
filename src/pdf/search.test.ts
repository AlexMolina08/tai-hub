import { describe, expect, it } from 'vitest'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import type { IndexDocument } from './model'
import { PageSearch } from './search'
import { matchRanges, queryWords, textRuns } from './text'

describe('PDF page search', () => {
  const first = { id: 'first', version: 'r1' }
  const second = { id: 'second', version: 'r1' }

  it('combines accent-insensitive terms on one exact page and preserves the visible snippet', () => {
    const search = new PageSearch()
    search.prepare([first, second])
    add(search, first, ['Ley orgánica', 'La administración electrónica facilita el acceso.'])
    add(search, second, ['Administración central', 'Electrónica aplicada'])

    expect(search.search('administracion electro', 20)).toEqual([{
      id: 'first', page: 2,
      snippet: 'La administración electrónica facilita el acceso.',
      terms: ['administracion', 'electro'],
    }])
    expect(search.search('%%', 20)).toEqual([])
  })

  it('drops removed and obsolete pages while retaining the rest of the library', () => {
    const search = new PageSearch()
    const newer = { ...first, version: 'r2' }
    search.prepare([first, second])
    add(search, first, ['El reglamento se aplica.'])
    add(search, second, ['El reglamento anterior.'])
    search.prepare([newer, second])
    add(search, first, ['El reglamento obsoleto no vuelve al índice.'])
    add(search, newer, ['El criterio nuevo.'])
    expect(search.search('reglamento', 20).map(result => result.id)).toEqual(['second'])
    expect(search.search('criterio', 20)[0]).toMatchObject({ id: 'first', page: 1 })
    search.prepare([newer])
    expect(search.search('reglamento', 20)).toEqual([])
  })

  it('resolves split PDF text runs and locates accented source text for highlights', () => {
    const items = [
      item('Adminis', 0, 22),
      item('tración', 22, 21),
      item('pública', 48, 22, true),
      item('AGE', 0, 12, false, 16),
    ]
    const runs = textRuns(items)
    expect(runs.text).toBe('Administración pública AGE')
    expect(runs.runs[1]).toEqual({ start: 7, end: 14 })
    const ranges = matchRanges(runs.text, queryWords('administracion PUBLI'))
    expect(ranges.map(range => runs.text.slice(range.start, range.end))).toEqual(['Administración', 'pública'])
  })
})

function add(search: PageSearch, doc: IndexDocument, texts: string[]) {
  search.put(doc, { schema: 1, pageCount: texts.length, failedPages: 0,
    pages: texts.map((text, index) => ({ page: index + 1, text })) })
}

function item(str: string, x: number, width: number, hasEOL = false, y = 0): TextItem {
  return { str, dir: 'ltr', transform: [10, 0, 0, 10, x, y], width, height: 10, fontName: 'Font', hasEOL }
}
