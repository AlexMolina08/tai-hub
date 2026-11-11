import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { LabEvent, LabPackage, Lesson } from './model'
import { LearningCapture } from './learning-capture'
import { semanticWriteBuffer } from './semantic-buffer'

/** Contact with visible lesson text is recorded, never inferred to be completed reading. */
export function LearningReading({ pack, lesson, accountId, deviceId, events, record, children }: {
  pack: LabPackage; lesson: Lesson; accountId: string; deviceId: string;
  events: LabEvent[]; record: (events: LabEvent[]) => Promise<void>; children: ReactNode
}) {
  const latest = useRef(events)
  latest.current = events
  const [capture] = useState(() => new LearningCapture(accountId, deviceId, () => latest.current))
  const target = { kind: 'lesson' as const, packageId: pack.id, packageVersion: pack.version, lessonId: lesson.id, lessonVersion: lesson.version }
  const buffer = semanticWriteBuffer(accountId, target)
  const entries = useSyncExternalStore(buffer.subscribe, buffer.snapshot)
  const [batch] = useState(() => buffer.hasUnsaved() ? [] : capture.reading(target))
  const [ready, setReady] = useState(false)
  useEffect(() => { buffer.acknowledge(events) }, [buffer, events])
  useEffect(() => {
    let active = true
    const saving = batch.length && !buffer.hasUnsaved()
      ? buffer.save(batch[0], incoming => capture.write(incoming, record), batch.slice(1)) : buffer.flush()
    void saving.then(saved => { if (active && saved) setReady(true) })
    return () => { active = false }
  }, [])
  if (ready) return children
  return entries.some(entry => entry.status === 'failed') ? <p role="status">No se pudo guardar la consulta. La explicación estará disponible al reintentar, para distinguir las respuestas con apoyo de lectura.
    <button className="text-link" onClick={() => {
      buffer.retry(incoming => capture.write(incoming, record))
      void buffer.flush().then(saved => { if (saved) setReady(true) })
    }}>Reintentar guardado</button></p> : <p role="status">Preparando la lectura…</p>
}
