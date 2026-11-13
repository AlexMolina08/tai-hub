import type { NoteRevision, NoteTarget } from './model'
import { noteKey } from './notes'
import { RevisionWriteBuffer } from './revision-buffer'

export class NoteWriteBuffer extends RevisionWriteBuffer<NoteRevision> {}

const buffers = new Map<string, NoteWriteBuffer>()
export function clearNoteBuffers(accountId: string) {
  for (const key of buffers.keys()) if (JSON.parse(key)[0] === accountId) buffers.delete(key)
  updateWarning()
}
let warningAttached = false
function warnBeforeUnload(event: BeforeUnloadEvent) {
  if ([...buffers.values()].some(buffer => buffer.hasUnsaved())) { event.preventDefault(); event.returnValue = '' }
}
function updateWarning() {
  if (typeof window === 'undefined') return
  const needed = [...buffers.values()].some(buffer => buffer.hasUnsaved())
  if (needed && !warningAttached) window.addEventListener('beforeunload', warnBeforeUnload)
  if (!needed && warningAttached) window.removeEventListener('beforeunload', warnBeforeUnload)
  warningAttached = needed
}

/** Personal content stays scoped to the account and exact activity/session edition. */
export function noteWriteBuffer(accountId: string, target: NoteTarget): NoteWriteBuffer {
  const key = JSON.stringify([accountId, noteKey(target)])
  let buffer = buffers.get(key)
  if (!buffer) { buffer = new NoteWriteBuffer(updateWarning); buffers.set(key, buffer) }
  return buffer
}
