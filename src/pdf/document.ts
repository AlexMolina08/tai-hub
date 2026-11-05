import { getDocument, GlobalWorkerOptions, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { DocumentInitParameters, PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { IndexedPdf, PdfSource } from './model'
import { openRangePdf, pdfAccessDenied } from './range'
import { isTextItem, textRuns } from './text'

GlobalWorkerOptions.workerSrc = workerUrl

export function openPdf(
  source: PdfSource,
  onRangeFailure?: (error: unknown) => void,
): Pick<PDFDocumentLoadingTask, 'promise' | 'destroy'> {
  const base = `${import.meta.env.BASE_URL}pdfjs/`
  const options: DocumentInitParameters = {
    ...source,
    cMapUrl: `${base}cmaps/`,
    iccUrl: `${base}iccs/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    rangeChunkSize: 256 * 1024,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: VerbosityLevel.ERRORS,
  }
  if (onRangeFailure && source.url && source.byteLength && Number.isSafeInteger(source.byteLength)
    && source.byteLength > 8 * 1024 * 1024) {
    return openRangePdf(source.url, source.httpHeaders, source.byteLength, options, onRangeFailure)
  }
  return getDocument(options)
}

export function pdfErrorMessage(error: unknown) {
  if (pdfAccessDenied(error)) return 'Drive ha rechazado el acceso. Vuelve a conectar tu cuenta o abre el PDF en Drive.'
  if (error && typeof error === 'object') {
    if ('name' in error) {
      if (error.name === 'PasswordException') return 'El PDF está protegido con contraseña. Ábrelo en Drive o descarga el original.'
      if (error.name === 'InvalidPDFException') return 'El archivo no se reconoce como PDF.'
    }
  }
  return 'No se ha podido leer el PDF. Comprueba la conexión o abre el original en Drive.'
}

export async function extractPdf(
  source: PdfSource,
  signal?: AbortSignal,
  onPage?: (page: number, total: number) => void,
): Promise<IndexedPdf> {
  signal?.throwIfAborted()
  const task = openPdf(source)
  let destroyed: Promise<void> | undefined
  const close = () => destroyed ??= task.destroy().catch(() => {})
  signal?.addEventListener('abort', close, { once: true })
  try {
    const document = await task.promise
    const value: IndexedPdf = { schema: 1, pageCount: document.numPages, failedPages: 0, pages: [] }
    for (let page = 1; page <= document.numPages; page++) {
      signal?.throwIfAborted()
      onPage?.(page, document.numPages)
      const pageProxy = await document.getPage(page).catch(() => null)
      try {
        if (!pageProxy) {
          value.failedPages++
          continue
        }
        const content = await pageProxy.getTextContent()
        const text = textRuns(content.items.filter(isTextItem)).text
          .replace(/\s+/gu, ' ').trim()
        if (/[\p{L}\p{N}]/u.test(text)) value.pages.push({ page, text })
      } catch {
        value.failedPages++
      } finally {
        pageProxy?.cleanup()
      }
    }
    signal?.throwIfAborted()
    if (value.failedPages === value.pageCount) throw new Error('No se ha podido extraer texto de las páginas del PDF.')
    return value
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  } finally {
    signal?.removeEventListener('abort', close)
    await close()
  }
}
