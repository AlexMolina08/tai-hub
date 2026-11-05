import MiniSearch from 'minisearch'
import type { IndexDocument, IndexedPdf, PdfSearchHit } from './model'
import { contextualSnippet, foldWord, queryWords } from './text'

interface SearchPage {
  key: string
  id: string
  page: number
  text: string
}

export class PageSearch {
  private versions = new Map<string, string>()
  private entries = new Map<string, SearchPage[]>()
  private pages = new Map<string, SearchPage>()
  private index = new MiniSearch<SearchPage>({
    idField: 'key',
    fields: ['text'],
    tokenize: text => text.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [],
    processTerm: foldWord,
  })

  prepare(documents: IndexDocument[]) {
    this.versions = new Map(documents.map(doc => [doc.id, doc.version]))
    for (const [id, pages] of this.entries) {
      const version = this.versions.get(id)
      if (version === undefined || pages.some(page => page.key !== key(id, version, page.page))) this.remove(id)
    }
  }

  put(document: IndexDocument, value: IndexedPdf) {
    if (this.versions.get(document.id) !== document.version) return
    this.remove(document.id)
    const pages = value.pages.map(page => ({
      ...page,
      id: document.id,
      key: key(document.id, document.version, page.page),
    }))
    this.index.addAll(pages)
    this.entries.set(document.id, pages)
    for (const page of pages) this.pages.set(page.key, page)
  }

  search(query: string, limit: number): PdfSearchHit[] {
    const terms = queryWords(query)
    if (!terms.length) return []
    return this.index.search(terms.join(' '), {
      combineWith: 'AND',
      prefix: term => term.length >= 3,
    }).slice(0, limit).flatMap(result => {
      const page = this.pages.get(String(result.id))
      return page ? [{ id: page.id, page: page.page, snippet: contextualSnippet(page.text, terms), terms }] : []
    })
  }

  private remove(id: string) {
    const pages = this.entries.get(id)
    if (!pages) return
    this.index.discardAll(pages.map(page => page.key))
    for (const page of pages) this.pages.delete(page.key)
    this.entries.delete(id)
  }
}

function key(id: string, version: string, page: number) {
  return JSON.stringify([id, version, page])
}
