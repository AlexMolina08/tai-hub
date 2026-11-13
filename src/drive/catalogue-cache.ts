import type { DriveAccount, Resource } from './types'

type Catalogue = { account: DriveAccount; resources: Resource[] }

async function access(accountId: string, value?: Catalogue): Promise<Catalogue | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('tai-hub-library-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('catalogues')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('La copia de la biblioteca está bloqueada.'))
  })
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('catalogues', value ? 'readwrite' : 'readonly')
      const store = tx.objectStore('catalogues')
      const request = value ? store.put(value, accountId) : store.get(accountId)
      tx.oncomplete = () => resolve(value ?? request.result)
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}

export async function readCatalogue(accountId: string) {
  const saved = await access(accountId)
  if (saved?.account.id === accountId && Array.isArray(saved.resources)) return saved
}

export async function saveCatalogue(account: DriveAccount, resources: Resource[]) {
  await access(account.id, { account, resources })
}
