import type { LabEvent } from './model'
import { mergeEvents } from './history'

export interface HistoryGeneration { id: string; createdTime: string }
export interface StoredHistory { events: LabEvent[]; pendingIds: string[]; generation?: HistoryGeneration }
export interface HistoryStore {
  read(): Promise<StoredHistory>
  update(change: (state: StoredHistory) => StoredHistory): Promise<StoredHistory>
}
const empty = (): StoredHistory => ({ events: [], pendingIds: [] })
const DB = 'tai-hub-laboratory-v1'
const STORE = 'accounts'

/** Every tab uses a single read-modify-write transaction. A failed write must reach the user. */
export function browserHistoryStore(accountId: string): HistoryStore {
  async function transact(change?: (state: StoredHistory) => StoredHistory): Promise<StoredHistory> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('Cierra otras pestañas para actualizar el almacenamiento del laboratorio.'))
    })
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, change ? 'readwrite' : 'readonly')
        const store = tx.objectStore(STORE)
        const req = store.get(accountId)
        let result: StoredHistory
        let failure: unknown
        req.onsuccess = () => {
          try {
            const stored = req.result as StoredHistory | undefined
            result = stored ?? empty()
            result.events = mergeEvents(accountId, result.events)
            if (!Array.isArray(result.pendingIds) || !result.pendingIds.every(id => result.events.some(e => e.id === id))) {
              throw new Error('La cola local no es válida. Conserva los datos para recuperarlos.')
            }
            if (change) { result = change(result); store.put(result, accountId) }
          } catch (error) { failure = error; tx.abort() }
        }
        tx.oncomplete = () => resolve(result)
        tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error('No se pudo guardar el progreso local.'))
      })
    } finally { db.close() }
  }
  return { read: () => transact(), update: change => transact(change) }
}
