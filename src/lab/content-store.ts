import type { LabPackage } from './model'
import { canonical } from './history'
import { parsePackage } from './validate'
import { familyConflicts } from './partitions'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tai-hub-lab-content-v1', 1)
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore('packages', { keyPath: ['accountId', 'id', 'version'] })
      store.createIndex('account', 'accountId')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
export async function cachedPackages(accountId: string): Promise<LabPackage[]> {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('packages', 'readonly')
      const req = tx.objectStore('packages').index('account').getAll(accountId)
      let result: LabPackage[] = []
      let error: unknown
      req.onsuccess = () => {
        try { result = req.result.map(row => parsePackage(row.content)) }
        catch (failure) { error = failure; tx.abort() }
      }
      tx.oncomplete = () => resolve(result)
      tx.onerror = tx.onabort = () => reject(error ?? tx.error)
    })
  } finally { db.close() }
}
export async function cachePackage(accountId: string, input: unknown): Promise<LabPackage> {
  const content = parsePackage(input)
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('packages', 'readwrite')
      const store = tx.objectStore('packages')
      const req = store.index('account').getAll(accountId)
      let failure: unknown
      req.onsuccess = () => {
        try {
          const previous = req.result.find(row => row.id === content.id && row.version === content.version)
          if (previous && canonical(previous.content) !== canonical(content)) {
            failure = new Error('Esa versión ya existe con otro contenido. Conserva ambos paquetes y asigna una versión nueva.')
            tx.abort(); return
          }
          const library = [...req.result.map(row => parsePackage(row.content)), content]
          const conflicts = familyConflicts(library.flatMap(pack => pack.activities), library)
          if (conflicts.length) { failure = new Error(conflicts.join('\n')); tx.abort(); return }
          store.put({ accountId, id: content.id, version: content.version, content })
        } catch (error) { failure = error; tx.abort() }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(failure ?? tx.error)
    })
    return content
  } finally { db.close() }
}
