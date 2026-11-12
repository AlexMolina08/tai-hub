import type { DriveLibrary } from '../drive/library'
import type { EventBatch } from './model'
import { canonical } from './history'
import type { LabTransport } from './sync'
import { parseEventBatch } from './validate'

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
