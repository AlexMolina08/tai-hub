import type { LabEvent, NoteRevision, NoteTarget } from './model'
import { noteKey } from './notes'
import { canonical } from './history'

type Writer = (events: LabEvent[]) => Promise<void>
interface BufferedNote { note: NoteRevision; status: 'pending' | 'failed' | 'saved'; error?: string; collision?: boolean }

/** Keeps local writes alive across editor navigation, including failures after unmount. */
export class NoteWriteBuffer {
  #entries: BufferedNote[] = []
  #listeners = new Set<() => void>()
  constructor(private changed: () => void = () => {}) {}
  snapshot = () => this.#entries
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener) } }
  hasUnsaved = () => this.#entries.some(entry => entry.status !== 'saved')
  #publish(entries: BufferedNote[]) {
    this.#entries = entries
    this.changed()
    this.#listeners.forEach(listener => listener())
  }
  /** Only an observed stored event allows its in-memory copy to be discarded. */
  acknowledge(events: LabEvent[]) {
    const known = new Map(events.map(event => [event.id, event]))
    let changed = false
    const remaining = this.#entries.flatMap(entry => {
      const stored = known.get(entry.note.id)
      if (!stored) return [entry]
      if (canonical(stored) === canonical(entry.note)) { changed = true; return [] }
      if (entry.collision) return [entry]
      changed = true
      return [{ ...entry, status: 'failed' as const, collision: true,
        error: 'Colisión de identidad: la copia guardada contiene otro texto. Conserva una copia de la nota pendiente para revisión.' }]
    })
    if (changed) this.#publish(remaining)
  }
  save(note: NoteRevision, record: Writer) {
    this.#publish([...this.#entries, { note, status: 'pending' }])
    // Start now, before navigation can close the current sync controller.
    void this.#write([note], record)
  }
  retry(record: Writer) {
    if (this.#entries.some(entry => entry.status === 'pending')) return
    const failed = this.#entries.filter(entry => entry.status === 'failed' && !entry.collision).map(entry => entry.note)
    if (!failed.length) return
    this.#publish(this.#entries.map(entry => entry.status === 'failed' && !entry.collision ? { note: entry.note, status: 'pending' } : entry))
    // Retry every failed ancestor together, even if a descendant was already saved.
    void this.#write(failed, record)
  }
  async #write(notes: NoteRevision[], record: Writer) {
    const ids = new Set(notes.map(note => note.id))
    try {
      await record(notes)
      this.#publish(this.#entries.map(entry => ids.has(entry.note.id) && !entry.collision ? { note: entry.note, status: 'saved' } : entry))
    } catch (failure) {
      const error = failure instanceof Error ? failure.message : 'No se pudo guardar la nota.'
      this.#publish(this.#entries.map(entry => ids.has(entry.note.id) && !entry.collision ? { note: entry.note, status: 'failed', error } : entry))
    }
  }
}

const buffers = new Map<string, NoteWriteBuffer>()
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
