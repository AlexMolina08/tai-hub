export interface PdfRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PdfAnnotation {
  id: string
  page: number
  kind: 'bookmark' | 'note' | 'highlight'
  text?: string
  rects?: PdfRect[]
  createdAt: string
}

export interface PdfReadingPosition {
  page: number
  offset?: number
  horizontal?: number
  zoom?: number
  readingMode?: boolean
}

export function isPdfReadingPosition(value: unknown): value is PdfReadingPosition {
  if (!value || typeof value !== 'object') return false
  const { page, offset, horizontal, zoom, readingMode } = value as PdfReadingPosition
  const fraction = (n?: number) => n === undefined || (Number.isFinite(n) && n >= 0 && n <= 1)
  return Number.isSafeInteger(page) && page >= 0 && fraction(offset) && fraction(horizontal)
    && (zoom === undefined || (Number.isFinite(zoom) && zoom >= 0.75 && zoom <= 3))
    && (readingMode === undefined || typeof readingMode === 'boolean')
}

export type PdfSource = {
  url: string
  httpHeaders?: Record<string, string>
  byteLength?: number
  data?: never
} | {
  data: ArrayBuffer | Uint8Array
  url?: never
  httpHeaders?: never
  byteLength?: never
}

export interface IndexDocument {
  id: string
  version: string
}

export interface IndexedPage {
  page: number
  text: string
}

export interface IndexedPdf {
  schema: 1
  pageCount: number
  failedPages: number
  pages: IndexedPage[]
}

export interface PdfSearchHit {
  id: string
  page: number
  snippet: string
  terms: string[]
}

export type IndexStatus = 'pending' | 'indexed' | 'no-text' | 'partial' | 'error'

export const pdfIndexSchema = 1

export function indexStatus(value: IndexedPdf): Exclude<IndexStatus, 'pending' | 'error'> {
  if (value.failedPages) return 'partial'
  return value.pages.length ? 'indexed' : 'no-text'
}

export function isIndexedPdf(value: unknown): value is IndexedPdf {
  if (!value || typeof value !== 'object') return false
  const pdf = value as IndexedPdf
  return pdf.schema === pdfIndexSchema &&
    Number.isSafeInteger(pdf.pageCount) && pdf.pageCount > 0 &&
    Number.isSafeInteger(pdf.failedPages) && pdf.failedPages >= 0 && pdf.failedPages <= pdf.pageCount &&
    Array.isArray(pdf.pages) && pdf.pages.length <= pdf.pageCount - pdf.failedPages &&
    pdf.pages.every((page, index) => page && Number.isSafeInteger(page.page) &&
      page.page >= 1 && page.page <= pdf.pageCount &&
      (!index || page.page > pdf.pages[index - 1].page) && typeof page.text === 'string')
}
