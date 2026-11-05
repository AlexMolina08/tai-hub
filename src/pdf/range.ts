import { getDocument, PDFDataRangeTransport } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { DocumentInitParameters, PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api'

class PdfRangeResponseError extends Error {
  constructor(readonly status: number) {
    super('Drive no ha devuelto el rango solicitado del PDF.')
  }
}

export function pdfAccessDenied(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'status' in error
    && (error.status === 401 || error.status === 403))
}

async function readRange(
  url: string, originalHeaders: Record<string, string> | undefined,
  begin: number, end: number, length: number, signal: AbortSignal,
) {
  const headers = new Headers(originalHeaders)
  headers.set('Range', `bytes=${begin}-${end - 1}`)
  const response = await fetch(url, { headers, signal, cache: 'no-store' })
  const contentRange = response.headers.get('Content-Range')
  if (response.status !== 206 || !response.body || (contentRange
    && contentRange !== `bytes ${begin}-${end - 1}/${length}`)) {
    await response.body?.cancel().catch(() => {})
    throw new PdfRangeResponseError(response.status)
  }

  // Drive can return 206 without exposing Content-Range to the browser.
  const bytes = new Uint8Array(end - begin)
  const reader = response.body.getReader()
  let offset = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (offset + value.byteLength > bytes.byteLength) {
        await reader.cancel().catch(() => {})
        throw new PdfRangeResponseError(response.status)
      }
      bytes.set(value, offset)
      offset += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  if (offset !== bytes.byteLength) throw new PdfRangeResponseError(response.status)
  return bytes
}

export function openRangePdf(
  url: string, headers: Record<string, string> | undefined, length: number,
  options: DocumentInitParameters, onFailure: (error: unknown) => void,
): Pick<PDFDocumentLoadingTask, 'promise' | 'destroy'> {
  const controller = new AbortController()
  const signal = controller.signal
  let task: PDFDocumentLoadingTask | undefined
  let closing: Promise<void> | undefined

  function destroy() {
    controller.abort()
    return closing ??= task?.destroy() ?? Promise.resolve()
  }

  async function load() {
    const firstChunk = await readRange(url, headers, 0, options.rangeChunkSize ?? 256 * 1024, length, signal)
      .catch(error => {
        signal.throwIfAborted()
        if (pdfAccessDenied(error)) throw error
        return null
      })
    signal.throwIfAborted()
    if (!firstChunk) {
      task = getDocument(options)
      return await task.promise
    }

    let rejectRange!: (error: unknown) => void
    const rangeFailure = new Promise<never>((_, reject) => { rejectRange = reject })
    class DriveRangeTransport extends PDFDataRangeTransport {
      requestDataRange(begin: number, end: number) {
        void readRange(url, headers, begin, end, length, signal).then(bytes => {
          if (!signal.aborted) this.onDataRange(begin, bytes)
        }).catch(error => {
          if (signal.aborted) return
          rejectRange(error)
          void destroy().catch(() => {})
          onFailure(error)
        })
      }

      abort() {
        controller.abort()
      }
    }

    task = getDocument({
      ...options,
      range: new DriveRangeTransport(length, firstChunk, true),
      disableAutoFetch: true,
      disableStream: true,
    })
    return await Promise.race([task.promise, rangeFailure])
  }

  return { promise: load(), destroy }
}
