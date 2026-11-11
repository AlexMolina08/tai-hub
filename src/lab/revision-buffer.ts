import type { Draft, LabEvent, NoteRevision } from './model'
import { canonical } from './history'

type Writer = (events: LabEvent[]) => Promise<void>
interface BufferedNote<T> { note: T; status: 'pending' | 'failed' | 'saved'; error?: string; collision?: boolean }

/** Keeps local writes alive across editor navigation, including failures after unmount. */
export class RevisionWriteBuffer<T extends NoteRevision | Draft> {
  #entries: BufferedNote<T>[] = []
  #listeners = new Set<() => void>()
  #writes = new Set<Promise<boolean>>()
  constructor(private changed: () => void = () => {}, private messages = {
    collision: 'Colisión de identidad: la copia guardada contiene otro texto. Conserva una copia de la nota pendiente para revisión.',
    failure: 'No se pudo guardar la nota.',
  }) {}
  snapshot = () => this.#entries
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener) } }
  hasUnsaved = () => this.#entries.some(entry => entry.status !== 'saved')
  #publish(entries: BufferedNote<T>[]) {
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
        error: this.messages.collision }]
    })
    if (changed) this.#publish(remaining)
  }
  save(note: T, record: Writer) {
    this.#publish([...this.#entries, { note, status: 'pending' }])
    // Start now, before navigation can close the current sync controller.
    return this.#start([note], record)
  }
  retry(record: Writer) {
    if (this.#entries.some(entry => entry.status === 'pending')) return
    const failed = this.#entries.filter(entry => entry.status === 'failed' && !entry.collision).map(entry => entry.note)
    if (!failed.length) return
    this.#publish(this.#entries.map(entry => entry.status === 'failed' && !entry.collision ? { note: entry.note, status: 'pending' } : entry))
    // Retry every failed ancestor together, even if a descendant was already saved.
    void this.#start(failed, record)
  }
  /** Execution or submission waits for local persistence, never just the visible editor text. */
  async flush() { await Promise.all([...this.#writes]); return !this.hasUnsaved() }
  #start(notes: T[], record: Writer) {
    const writing = this.#write(notes, record)
    this.#writes.add(writing)
    void writing.finally(() => this.#writes.delete(writing))
    return writing
  }
  async #write(notes: T[], record: Writer) {
    const ids = new Set(notes.map(note => note.id))
    try {
      await record(notes)
      this.#publish(this.#entries.map(entry => ids.has(entry.note.id) && !entry.collision ? { note: entry.note, status: 'saved' } : entry))
      return !this.#entries.some(entry => ids.has(entry.note.id) && entry.collision)
    } catch (failure) {
      const error = failure instanceof Error ? failure.message : this.messages.failure
      this.#publish(this.#entries.map(entry => ids.has(entry.note.id) && !entry.collision ? { note: entry.note, status: 'failed', error } : entry))
      return false
    }
  }
}

