import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { LabEvent, LabPackage, Lesson } from './model'
import { LearningCapture } from './learning-capture'
import { semanticWriteBuffer } from './semantic-buffer'

/** Contact with visible lesson text is recorded, never inferred to be completed reading. */
export function LearningReading({ pack, lesson, accountId, deviceId, events, record }: {
  pack: LabPackage; lesson: Lesson; accountId: string; deviceId: string;
  events: LabEvent[]; record: (events: LabEvent[]) => Promise<void>
}) {
  const latest = useRef(events)
  latest.current = events
  const [capture] = useState(() => new LearningCapture(accountId, deviceId, () => latest.current))
  const target = { kind: 'lesson' as const, packageId: pack.id, packageVersion: pack.version, lessonId: lesson.id, lessonVersion: lesson.version }
  const buffer = semanticWriteBuffer(accountId, target)
  const entries = useSyncExternalStore(buffer.subscribe, buffer.snapshot)
  const [batch] = useState(() => buffer.hasUnsaved() ? [] : capture.reading(target))
  useEffect(() => { buffer.acknowledge(events) }, [buffer, events])
  useEffect(() => {
    if (batch.length && !buffer.hasUnsaved()) void buffer.save(batch[0], incoming => capture.write(incoming, record), batch.slice(1))
  }, [])
  return entries.some(entry => entry.status === 'failed') ? <p role="status">No se guardó el contacto con esta lectura. Se conserva en esta pestaña para reintentarlo; la fecha del próximo repaso puede quedar incompleta.
    <button className="text-link" onClick={() => buffer.retry(incoming => capture.write(incoming, record))}>Reintentar guardado</button></p> : null
}
