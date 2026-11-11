import { useEffect, useId, useMemo, useSyncExternalStore } from 'react'
import type { LabEvent, NoteRevision, NoteTarget } from './model'
import { noteHeads } from './notes'
import { noteWriteBuffer } from './note-buffer'
import { exportHistory, mergeEvents } from './history'

export function StudyNoteEditor({ target, accountId, deviceId, events, record, label }: {
  target: NoteTarget; accountId: string; deviceId: string; events: LabEvent[]
  record: (events: LabEvent[]) => Promise<void>; label: string
}) {
  const id = useId()
  const buffer = noteWriteBuffer(accountId, target)
  const entries = useSyncExternalStore(buffer.subscribe, buffer.snapshot)
  useEffect(() => { buffer.acknowledge(events) }, [buffer, events])
  const revisions = useMemo(() => {
    const local = entries.map(entry => entry.note)
    try { return { heads: noteHeads(mergeEvents(accountId, events, local), accountId, target), error: '' } }
    catch (failure) { return { heads: noteHeads(local, accountId, target), error: failure instanceof Error ? failure.message : 'No se pudo leer la nota.' } }
  }, [events, entries, accountId, target])
  const heads = revisions.heads
  const current = heads.length === 1 ? heads[0] : undefined
  const pending = entries.some(entry => entry.status === 'pending')
  const failed = entries.filter(entry => entry.status === 'failed')
  const error = failed[0]?.error

  function downloadPending() {
    const url = URL.createObjectURL(new Blob([exportHistory(accountId, entries.map(entry => entry.note))], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'laboratorio-notas-pendientes.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function save(next: string, parents?: string[]) {
    if (next === current?.value && parents === undefined) return
    const note: NoteRevision = { id: crypto.randomUUID(), kind: 'note', accountId, deviceId, createdAt: new Date().toISOString(),
      target, value: next, parentIds: parents ?? (current ? [current.id] : []) }
    buffer.save(note, record)
  }
  return <section className="lab-note" aria-label={label}>
    <label htmlFor={id}>{label}</label>
    <p id={id + '-help'}>Se guarda en tu progreso. Estas notas no se califican.</p>
    <textarea id={id} rows={3} maxLength={4000} value={current?.value ?? ''} aria-describedby={id + '-help'}
      readOnly={!!revisions.error} disabled={heads.length > 1} onChange={event => save(event.target.value)} />
    <p className="lab-mode" role="status">{pending ? 'Guardando nota…' : failed.length ? 'Nota pendiente de guardar.' : current ? 'Nota guardada.' : 'Puedes escribir hasta 4000 caracteres.'}</p>
    {failed.length > 0 && <p role="alert">{error} El texto sigue disponible en esta pestaña. {failed.some(entry => entry.collision)
      ? 'Guarda una copia antes de cerrarla.' : 'Reintenta el guardado antes de cerrarla.'}</p>}
    {revisions.error && <p role="alert">{revisions.error}</p>}
    {failed.length > 0 && <div className="lab-actions">
      <button className="button" disabled={pending || failed.every(entry => entry.collision)} onClick={() => buffer.retry(record)}>Reintentar guardar nota</button>
      <button className="button" onClick={downloadPending}>Guardar copia de la nota pendiente</button>
    </div>}
    {heads.length > 1 && <div role="alert"><h4>Hay versiones distintas de esta nota</h4>
      <p>Elige cuál continuar. Las demás versiones se conservan en el historial.</p>
      {heads.map(head => <div key={head.id} className="lab-note-version"><p>{head.value || 'Nota vacía'}</p>
        <button className="button" disabled={pending || failed.length > 0} onClick={() => save(head.value, heads.map(note => note.id))}>Continuar con esta versión</button>
      </div>)}
    </div>}
  </section>
}
