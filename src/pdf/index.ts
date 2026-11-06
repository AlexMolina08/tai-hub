import type { IndexCacheEntry } from './index-db'
import type { IndexRequest, IndexResponse, IndexResult } from './index-protocol'
import type { IndexDocument, IndexedPdf, IndexStatus, PdfSource } from './model'
import { indexStatus, isIndexedPdf, pdfIndexSchema } from './model'

export type { IndexDocument, IndexStatus, PdfSearchHit, PdfSource } from './model'

export interface RemotePdfIndex {
  loadIndex<T>(id: string, version: string): Promise<T | null>
  saveIndex<T>(id: string, version: string, value: T): Promise<void>
}

export interface IndexProgress {
  current: number
  total: number
  documentId: string
  phase: 'cache' | 'drive' | 'extract' | 'save' | 'done' | 'error'
  page?: number
  pages?: number
  error?: string
}

interface SyncOptions {
  source: (id: string) => PdfSource | Promise<PdfSource>
  onProgress?: (progress: IndexProgress) => void
  signal?: AbortSignal
}

export class PdfIndex {
  private worker = new Worker(new URL('./index.worker.ts', import.meta.url), { type: 'module' })
  private requestId = 0
  private replies = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>()
  private statuses = new Map<string, IndexStatus>()
  private running?: { promise: Promise<void>; documents: IndexDocument[]; signal?: AbortSignal }
  private hydration?: { key: string; promise: Promise<void> }
  private failure?: Error

  constructor(private accountId: string, private remote?: RemotePdfIndex) {
    this.worker.onmessage = ({ data }: MessageEvent<IndexResponse>) => {
      const reply = this.replies.get(data.requestId)
      if (!reply) return
      this.replies.delete(data.requestId)
      if (data.ok) reply.resolve(data.result)
      else reply.reject(new Error('No se ha podido actualizar el índice de búsqueda.'))
    }
    this.worker.onerror = () => this.dispose(new Error('No se ha podido iniciar el índice de búsqueda.'))
  }

  hydrate(documents: IndexDocument[]) {
    const key = JSON.stringify(documents)
    if (this.hydration?.key === key) return this.hydration.promise
    const promise = this.request({ type: 'prepare', account: this.accountId, documents }).then(statuses => {
      if (this.hydration?.promise !== promise) return
      for (const { document, status } of statuses) this.statuses.set(this.key(document), status)
    }).catch(error => {
      if (this.hydration?.promise === promise) this.hydration = undefined
      throw error
    })
    this.hydration = { key, promise }
    return promise
  }

  sync(documents: IndexDocument[], options: SyncOptions) {
    const previous = this.running
    if (previous?.documents === documents && previous.signal === options.signal) return previous.promise
    const settled = previous?.promise.catch(() => {}) ?? Promise.resolve()
    const promise = settled.then(() => this.run(documents, options)).finally(() => {
      if (this.running?.promise === promise) this.running = undefined
    })
    this.running = { promise, documents, signal: options.signal }
    return promise
  }

  status(document: IndexDocument) {
    return this.statuses.get(this.key(document)) ?? 'pending'
  }

  search(query: string, limit = 60) {
    return this.request({ type: 'search', query, limit })
  }

  dispose(reason = new Error('Se ha cerrado el índice de búsqueda.')) {
    this.failure = reason
    this.worker.terminate()
    for (const reply of this.replies.values()) reply.reject(reason)
    this.replies.clear()
  }

  private key(document: IndexDocument) {
    return JSON.stringify([document.id, document.version])
  }

  private request<T extends IndexRequest>(request: T): Promise<IndexResult<T>> {
    if (this.failure) return Promise.reject(this.failure)
    const requestId = ++this.requestId
    return new Promise((resolve, reject) => {
      this.replies.set(requestId, { resolve: value => resolve(value as IndexResult<T>), reject })
      this.worker.postMessage({ requestId, request })
    })
  }

  private async run(documents: IndexDocument[], { source, onProgress, signal }: SyncOptions) {
    signal?.throwIfAborted()
    await this.hydrate(documents)
    for (const [offset, document] of documents.entries()) {
      signal?.throwIfAborted()
      if (this.failure) throw this.failure
      const update = (phase: IndexProgress['phase'], extra: Partial<IndexProgress> = {}) =>
        onProgress?.({ current: offset + 1, total: documents.length, documentId: document.id, phase, ...extra })
      const driveVersion = `${pdfIndexSchema}:${document.version}`
      try {
        update('cache')
        const local = await this.request({ type: 'get', account: this.accountId, document })
        // Hydration already loaded these pages into the worker's search index.
        if (local === 'uploaded' || (local && !this.remote)) continue
        let entry: IndexCacheEntry | undefined = local ?? undefined
        if (!entry && this.remote) {
          update('drive')
          const saved = await this.remote.loadIndex<IndexedPdf>(document.id, driveVersion)
          if (isIndexedPdf(saved)) {
            entry = { value: saved, uploaded: true, version: document.version }
            await this.store(document, entry)
          }
        }
        if (!entry) {
          signal?.throwIfAborted()
          const { extractPdf } = await import('./document')
          signal?.throwIfAborted()
          update('extract')
          const value = await extractPdf(await source(document.id), signal, (page, pages) => {
            if (page === 1 || page === pages || page % 10 === 0) update('extract', { page, pages })
          })
          entry = { value, uploaded: false, version: document.version }
          await this.store(document, entry)
        }
        signal?.throwIfAborted()
        if (this.remote && !entry.uploaded) {
          update('save')
          try {
            await this.remote.saveIndex(document.id, driveVersion, entry.value)
            await this.store(document, { ...entry, uploaded: true })
          } catch {
            update('done', { error: 'Índice local listo. Drive no ha guardado la copia sincronizada.' })
            continue
          }
        }
        update('done')
      } catch (error) {
        if (this.failure) throw this.failure
        signal?.throwIfAborted()
        this.statuses.set(this.key(document), 'error')
        const { pdfErrorMessage } = await import('./document')
        update('error', { error: pdfErrorMessage(error) })
      }
    }
  }

  private async store(document: IndexDocument, entry: IndexCacheEntry) {
    await this.request({ type: 'put', account: this.accountId, document, entry })
    this.statuses.set(this.key(document), indexStatus(entry.value))
  }
}
