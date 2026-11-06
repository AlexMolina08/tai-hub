import type { IndexCacheEntry } from './index-db'
import type { IndexDocument, IndexStatus, PdfSearchHit } from './model'

export type IndexRequest =
  | { type: 'prepare'; account: string; documents: IndexDocument[] }
  | { type: 'get'; account: string; document: IndexDocument }
  | { type: 'put'; account: string; document: IndexDocument; entry: IndexCacheEntry }
  | { type: 'search'; query: string; limit: number }

export type IndexResult<T extends IndexRequest> =
  T['type'] extends 'prepare' ? Array<{ document: IndexDocument; status: IndexStatus }> :
  T['type'] extends 'get' ? IndexCacheEntry | 'uploaded' | null :
  T['type'] extends 'put' ? boolean :
  T['type'] extends 'search' ? PdfSearchHit[] : never

export type IndexResponse = { requestId: number; result: unknown; ok: true } | { requestId: number; ok: false }
