import { labPackageRevision, type DriveLibrary, type LabPackageDownload } from '../drive/library'
import { cacheDownloadedPackages, cachedCatalogue, cachedPackages } from './content-store'
import type { EventBatch } from './model'
import { canonical } from './history'
import type { LabTransport } from './sync'
import { parseEventBatch } from './validate'

const checkpointBytes = 16 * 1024 ** 2
export async function loadLabCatalogue(library: DriveLibrary, accountId: string, progress: (ready: number, total: number) => void) {
  const [cached, files] = await Promise.all([cachedCatalogue(accountId), library.listLabFiles(accountId, 'labPackage')])
  const verified = new Map(cached.revisions.map(revision => [revision.fileId, revision]))
  const pending = files.filter(file => {
    const old = verified.get(file.id)
    const current = labPackageRevision(file)
    return !old || !current || old.headRevisionId !== current.headRevisionId || old.sha256 !== current.sha256
  })
  let ready = files.length - pending.length
  progress(ready, files.length)
  if (!pending.length) return cached.packages

  let buffered: LabPackageDownload[][] = []
  let bytes = 0
  function advance(count: number) {
    ready += count
    progress(ready, files.length)
  }
  async function flush() {
    const batches = buffered
    buffered = []
    bytes = 0
    const downloads = batches.flat()
    try {
      await cacheDownloadedPackages(accountId, downloads)
    } catch (failure) {
      if (batches.length === 1) throw failure
      // Preserve the independently valid batches before the first failure.
      for (const batch of batches) {
        await cacheDownloadedPackages(accountId, batch)
        advance(batch.length)
      }
      return
    }
    advance(downloads.length)
  }
  try {
    // Group small downloads for storage while keeping requests bounded.
    for (let offset = 0; offset < pending.length; offset += 8) {
      const batch = await Promise.all(pending.slice(offset, offset + 8).map(file => library.readLabPackage(accountId, file.id)))
      const batchBytes = batch.reduce((sum, item) => sum + item.bytes, 0)
      if (buffered.length && bytes + batchBytes > checkpointBytes) await flush()
      buffered.push(batch)
      bytes += batchBytes
      if (buffered.length === 4 || bytes >= checkpointBytes) await flush()
    }
  } finally {
    if (buffered.length) await flush()
  }
  return cachedPackages(accountId)
}

function eventBatches(batch: EventBatch): EventBatch[] {
  const maxBytes = 3 * 1024 ** 2
  const encoder = new TextEncoder()
  const overhead = encoder.encode(JSON.stringify({ ...batch, events: [] })).byteLength
  const batches: EventBatch[] = []
  let events: EventBatch['events'] = []
  let size = overhead
  for (const event of batch.events) {
    const bytes = encoder.encode(JSON.stringify(event)).byteLength + 1
    if (overhead + bytes > 32 * 1024 ** 2) throw new Error('Un evento supera el tamaño admitido para sincronizarlo en Drive.')
    if (events.length && size + bytes > maxBytes) {
      batches.push({ ...batch, events })
      events = []
      size = overhead
    }
    events.push(event)
    size += bytes
  }
  if (events.length) batches.push({ ...batch, events })
  return batches
}

export function labTransport(library: DriveLibrary, accountId: string): LabTransport {
  return {
    list: () => library.listLabFiles(accountId, 'labEvents'),
    read: id => library.readLabFile(accountId, id, 'labEvents'),
    async append(batch) {
      for (const part of eventBatches(batch)) await library.appendLabEvents(accountId, part)
    },
    async compact(files, batch) {
      const sources = files.filter(file => file.headRevisionId)
      if (sources.length !== files.length) return
      const parts = eventBatches(batch)
      if (parts.length >= sources.length) return
      for (const part of parts) {
        const { id } = await library.appendLabEvents(accountId, part)
        const stored = parseEventBatch(await library.readLabFile(accountId, id, 'labEvents'), accountId)
        if (canonical(stored) !== canonical(part)) throw new Error('No se pudo verificar la copia compactada del progreso.')
      }
      await library.archiveLabEvents(accountId, sources)
    },
  }
}
