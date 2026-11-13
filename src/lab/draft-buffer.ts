import type { ActivityRef, Draft } from './model'
import { RevisionWriteBuffer } from './revision-buffer'

const buffers = new Map<string, RevisionWriteBuffer<Draft>>()
export function clearDraftBuffers(accountId: string) {
  for (const key of buffers.keys()) if (JSON.parse(key)[0] === accountId) buffers.delete(key)
  updateWarning()
}
let warningAttached = false
function warn(event: BeforeUnloadEvent) {
  if ([...buffers.values()].some(buffer => buffer.hasUnsaved())) { event.preventDefault(); event.returnValue = '' }
}
function updateWarning() {
  if (typeof window === 'undefined') return
  const needed = [...buffers.values()].some(buffer => buffer.hasUnsaved())
  if (needed && !warningAttached) window.addEventListener('beforeunload', warn)
  if (!needed && warningAttached) window.removeEventListener('beforeunload', warn)
  warningAttached = needed
}

/** Edits remain available after navigation, scoped to the account and exact content edition. */
export function draftWriteBuffer(accountId: string, ref: ActivityRef) {
  const key = JSON.stringify([accountId, ref.packageId, ref.packageVersion, ref.activityId, ref.activityVersion])
  let buffer = buffers.get(key)
  if (!buffer) {
    buffer = new RevisionWriteBuffer<Draft>(updateWarning, {
      collision: 'Colisión de identidad: la copia guardada contiene otro borrador. Conserva una copia del borrador pendiente para revisión.',
      failure: 'No se pudo guardar el borrador.',
    })
    buffers.set(key, buffer)
  }
  return buffer
}
