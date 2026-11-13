import type { LabPackage } from './model'
import type { LabPackageDownload, LabPackageRevision } from '../drive/library'
import { canonical } from './history'
import { parsePackage } from './validate'
import { familyConflicts } from './partitions'

type StoredPackage = {
  accountId: string; id: string; version: string; content: LabPackage; revision?: LabPackageRevision
}
type CachedCatalogue = { packages: LabPackage[]; revisions: LabPackageRevision[] }

// Large catalogues can exhaust WebKit's memory when IndexedDB deserializes every row at once.
const readBatchSize = 16

function readRows(store: IDBObjectStore, accountId: string, collect: (rows: StoredPackage[]) => void,
  fail: (error: unknown) => void, complete?: () => void) {
  const lastKey = [accountId, []]
  const next = (from: IDBValidKey, exclusive: boolean) => {
    const request = store.getAll(IDBKeyRange.bound(from, lastKey, exclusive, true), readBatchSize)
    request.onsuccess = () => {
      try {
        const rows = request.result as StoredPackage[]
        collect(rows)
        if (rows.length < readBatchSize) complete?.()
        else {
          const last = rows[rows.length - 1]
          next([accountId, last.id, last.version], true)
        }
      } catch (error) { fail(error) }
    }
  }
  next([accountId], false)
}

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
export async function cachedCatalogue(accountId: string): Promise<CachedCatalogue> {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('packages', 'readonly')
      const result: CachedCatalogue = { packages: [], revisions: [] }
      let error: unknown
      readRows(tx.objectStore('packages'), accountId, rows => {
        for (const row of rows) {
          result.packages.push(parsePackage(row.content))
          if (row.revision) result.revisions.push(row.revision)
        }
      }, failure => { error = failure; tx.abort() })
      tx.oncomplete = () => resolve(result)
      tx.onerror = tx.onabort = () => reject(error ?? tx.error)
    })
  } finally { db.close() }
}
export async function cachedPackages(accountId: string): Promise<LabPackage[]> {
  return (await cachedCatalogue(accountId)).packages
}
export async function cachePackages(accountId: string, inputs: unknown[]): Promise<void> {
  return cacheDownloadedPackages(accountId, inputs.map(content => ({ content })))
}
export async function cacheDownloadedPackages(accountId: string, inputs: Pick<LabPackageDownload, 'content' | 'revision'>[]): Promise<void> {
  const incoming = inputs.map(({ content, revision }) => {
    const pack = parsePackage(content)
    return { accountId, id: pack.id, version: pack.version, content: pack, revision }
  })
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('packages', 'readwrite')
      const store = tx.objectStore('packages')
      let failure: unknown
      const packageKey = ({ id, version }: LabPackage) => JSON.stringify([id, version])
      const library = new Map<string, StoredPackage>()
      readRows(store, accountId, rows => {
        for (const row of rows) {
          const content = parsePackage(row.content)
          library.set(packageKey(content), { ...row, content })
        }
      }, error => { failure = error; tx.abort() }, () => {
        const updates = new Map<string, StoredPackage>()
        let added = false
        for (const row of incoming) {
          const key = packageKey(row.content)
          const previous = library.get(key)
          if (previous) {
            if (canonical(previous.content) !== canonical(row.content)) {
              throw new Error('Esa versión ya existe con otro contenido. Conserva ambos paquetes y asigna una versión nueva.')
            }
            if (!row.revision || (previous.revision?.fileId === row.revision.fileId
              && previous.revision.headRevisionId === row.revision.headRevisionId
              && previous.revision.sha256 === row.revision.sha256)) continue
          } else {
            added = true
          }
          library.set(key, row)
          updates.set(key, row)
        }
        if (added) {
          const packages = [...library.values()].map(row => row.content)
          const conflicts = familyConflicts(packages.flatMap(pack => pack.activities), packages)
          if (conflicts.length) throw new Error(conflicts.join('\n'))
        }
        for (const row of updates.values()) store.put(row)
      })
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(failure ?? tx.error)
    })
  } finally { db.close() }
}
