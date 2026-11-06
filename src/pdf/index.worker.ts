import { readCache, writeCache } from './index-db'
import type { IndexCacheEntry } from './index-db'
import type { IndexRequest, IndexResponse } from './index-protocol'
import { indexStatus } from './model'
import { PageSearch } from './search'

const search = new PageSearch()
const cache = new Map<string, IndexCacheEntry>()
let active = new Map<string, string>()
const worker = self as unknown as {
  onmessage: ((event: MessageEvent<{ requestId: number; request: IndexRequest }>) => void) | null
  postMessage(response: IndexResponse): void
}

worker.onmessage = async ({ data: { requestId, request } }) => {
  try {
    const result = await handle(request)
    worker.postMessage({ requestId, result, ok: true })
  } catch {
    worker.postMessage({ requestId, ok: false })
  }
}

async function handle(request: IndexRequest) {
  switch (request.type) {
    case 'prepare': {
      active = new Map(request.documents.map(document => [document.id, document.version]))
      search.prepare(request.documents)
      for (const [id, entry] of cache) {
        if (active.get(id) !== entry.version) cache.delete(id)
      }
      const statuses = []
      for (const document of request.documents) {
        let entry = cache.get(document.id)
        if (!entry) {
          const stored = await readCache(request.account, document)
          if (stored && active.get(document.id) === document.version) {
            entry = cache.get(document.id) ?? stored
            if (!cache.has(document.id)) {
              search.put(document, stored.value)
              cache.set(document.id, stored)
            }
          }
        }
        if (entry?.version === document.version) statuses.push({ document, status: indexStatus(entry.value) })
      }
      return statuses
    }
    case 'get': {
      const cached = cache.get(request.document.id)
      const entry = cached?.version === request.document.version
        ? cached : await readCache(request.account, request.document)
      return entry?.uploaded ? 'uploaded' : entry
    }
    case 'put': {
      if (active.get(request.document.id) !== request.document.version) return false
      if (cache.get(request.document.id)?.version !== request.entry.version) search.put(request.document, request.entry.value)
      cache.set(request.document.id, request.entry)
      return await writeCache(request.account, request.document, request.entry)
    }
    case 'search':
      return search.search(request.query, request.limit)
  }
}
