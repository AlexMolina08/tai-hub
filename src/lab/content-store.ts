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
export async function cachePackages(accountId: string, inputs: unknown[]): Promise<void> {
  const incoming = inputs.map(input => parsePackage(input))
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('packages', 'readwrite')
      const store = tx.objectStore('packages')
      const req = store.index('account').getAll(accountId)
      let failure: unknown
      req.onsuccess = () => {
        try {
          const packageKey = ({ id, version }: LabPackage) => JSON.stringify([id, version])
          const library = new Map<string, LabPackage>()
          for (const row of req.result) {
            const pack = parsePackage(row.content)
            library.set(packageKey(pack), pack)
          }
          const additions: LabPackage[] = []
          for (const pack of incoming) {
            const key = packageKey(pack)
            const previous = library.get(key)
            if (previous) {
              if (canonical(previous) !== canonical(pack)) {
                throw new Error('Esa versión ya existe con otro contenido. Conserva ambos paquetes y asigna una versión nueva.')
              }
              continue
            }
            library.set(key, pack)
            additions.push(pack)
          }
          if (!additions.length) return
          const packages = [...library.values()]
          const conflicts = familyConflicts(packages.flatMap(pack => pack.activities), packages)
          if (conflicts.length) throw new Error(conflicts.join('\n'))
          for (const content of additions) store.add({ accountId, id: content.id, version: content.version, content })
        } catch (error) { failure = error; tx.abort() }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(failure ?? tx.error)
    })
  } finally { db.close() }
}
