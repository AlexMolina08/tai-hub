import type { IndexDocument, IndexedPdf } from './model'
import { isIndexedPdf } from './model'

export interface IndexCacheEntry {
  version: string
  uploaded: boolean
  value: IndexedPdf
}

const storeName = 'documents'
let database: Promise<IDBDatabase | null> | undefined

function openCache() {
  return database ??= new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    const request = indexedDB.open('tai-hub-pdf-index', 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

export async function readCache(account: string, document: IndexDocument): Promise<IndexCacheEntry | null> {
  try {
    const db = await openCache()
    if (!db) return null
    return await new Promise(resolve => {
      const transaction = db.transaction(storeName, 'readonly')
      const request = transaction.objectStore(storeName).get([account, document.id, document.version])
      request.onsuccess = () => {
        const value: IndexCacheEntry | undefined = request.result
        resolve(value?.version === document.version && isIndexedPdf(value.value) ? value : null)
      }
      request.onerror = () => resolve(null)
      transaction.onabort = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function writeCache(account: string, document: IndexDocument, entry: IndexCacheEntry): Promise<boolean> {
  try {
    const db = await openCache()
    if (!db) return false
    return await new Promise(resolve => {
      const transaction = db.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).put(entry, [account, document.id, document.version])
      transaction.oncomplete = () => resolve(true)
      transaction.onabort = () => resolve(false)
      transaction.onerror = () => resolve(false)
    })
  } catch {
    return false
  }
}
