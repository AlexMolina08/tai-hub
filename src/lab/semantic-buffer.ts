import type { ActivityRef, LabEvent, LearningTarget } from './model'
import { RevisionWriteBuffer } from './revision-buffer'

const buffers = new Map<string, RevisionWriteBuffer<LabEvent>>()
export function clearSemanticBuffers(accountId: string) {
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

/** Failed answer/help/contact batches retain their IDs and clocks across internal navigation.
 * Memory cannot survive closing the page after a storage failure; export remains available.
 */
export function semanticWriteBuffer(accountId: string, target: ActivityRef | Extract<LearningTarget, { kind: 'lesson' }>) {
  const key = JSON.stringify([accountId, target.packageId, target.packageVersion,
    'activityId' in target ? ['activity', target.activityId, target.activityVersion] : ['lesson', target.lessonId, target.lessonVersion]])
  let buffer = buffers.get(key)
  if (!buffer) {
    buffer = new RevisionWriteBuffer<LabEvent>(updateWarning, {
      collision: 'Hay una colisión con el historial guardado. Descarga la copia pendiente para conservar ambos registros.',
      failure: 'No se pudo guardar la respuesta o la consulta de ayuda.',
    })
    buffers.set(key, buffer)
  }
  return buffer
}
