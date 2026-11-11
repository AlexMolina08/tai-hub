import type { LabEvent } from './model'
import { canonical } from './history'

type Writer = (events: LabEvent[]) => Promise<void>
interface BufferedNote<T> { note: T; companions?: LabEvent[]; status: 'pending' | 'failed' | 'saved'; error?: string; collision?: boolean }
const entryEvents = <T extends LabEvent>(entry: BufferedNote<T>): LabEvent[] => [entry.note, ...(entry.companions ?? [])]

/** Keeps local writes alive across editor navigation, including failures after unmount. */
export class RevisionWriteBuffer<T extends LabEvent> {
  #entries: BufferedNote<T>[] = []
  #listeners = new Set<() => void>()
  #writes = new Set<Promise<boolean>>()
  constructor(private changed: () => void = () => {}, private messages = {
    collision: 'Colisión de identidad: la copia guardada contiene otro texto. Conserva una copia de la nota pendiente para revisión.',
    failure: 'No se pudo guardar la nota.',
  }) {}
  snapshot = () => this.#entries
  events = () => this.#entries.flatMap(entryEvents)
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
      const expected = entryEvents(entry)
      const collision = expected.some(event => known.has(event.id) && canonical(known.get(event.id)) !== canonical(event))
      if (!collision) {
        if (expected.every(event => known.has(event.id))) { changed = true; return [] }
        return [entry]
      }
      if (entry.collision) return [entry]
      changed = true
      return [{ ...entry, status: 'failed' as const, collision: true,
        error: this.messages.collision }]
    })
    if (changed) this.#publish(remaining)
  }
  /** Companion events share the local transaction and remain recoverable with their draft. */
  save(note: T, record: Writer, companions: LabEvent[] = []) {
    const entry: BufferedNote<T> = structuredClone({ note, ...(companions.length ? { companions } : {}), status: 'pending' })
    this.#publish([...this.#entries, entry])
    // Start now, before navigation can close the current sync controller.
    return this.#start([entry], record)
  }
  retry(record: Writer) {
    if (this.#entries.some(entry => entry.status === 'pending')) return
    const failed = this.#entries.filter(entry => entry.status === 'failed' && !entry.collision)
    if (!failed.length) return
    this.#publish(this.#entries.map(entry => entry.status === 'failed' && !entry.collision ? { ...entry, status: 'pending', error: undefined } : entry))
    // Retry every failed ancestor together, even if a descendant was already saved.
    void this.#start(failed, record)
  }
  /** Execution or submission waits for local persistence, never just the visible editor text. */
  async flush() { await Promise.all([...this.#writes]); return !this.hasUnsaved() }
  #start(entries: BufferedNote<T>[], record: Writer) {
    const writing = this.#write(entries, record)
    this.#writes.add(writing)
    void writing.finally(() => this.#writes.delete(writing))
    return writing
  }
  async #write(entries: BufferedNote<T>[], record: Writer) {
    const ids = new Set(entries.map(entry => entry.note.id))
    try {
      await record(entries.flatMap(entryEvents))
      this.#publish(this.#entries.map(entry => ids.has(entry.note.id) && !entry.collision ? { ...entry, status: 'saved', error: undefined } : entry))
      return !this.#entries.some(entry => ids.has(entry.note.id) && entry.collision)
    } catch (failure) {
      const error = failure instanceof Error ? failure.message : this.messages.failure
      this.#publish(this.#entries.map(entry => ids.has(entry.note.id) && !entry.collision ? { ...entry, status: 'failed', error } : entry))
      return false
    }
  }
}

