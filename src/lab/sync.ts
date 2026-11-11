import type { EventBatch, LabEvent } from './model'
import type { HistoryStore, StoredHistory } from './store'
import { mergeEvents } from './history'
import { parseEventBatch } from './validate'

export interface LabTransport {
  list(): Promise<{ id: string }[]>
  read(id: string): Promise<unknown>
  append(batch: EventBatch): Promise<void>
}
export type LabSyncStatus = 'local' | 'pending' | 'syncing' | 'synced' | 'error'
export interface LabSnapshot extends StoredHistory { status: LabSyncStatus; error?: string }

/** Immutable remote batches avoid shared-file overwrites. Duplicate uploads are harmless by event identity. */
export class LabSync {
  #snapshot: LabSnapshot = { events: [], pendingIds: [], status: 'local' }
  #listeners = new Set<() => void>()
  #running?: Promise<void>
  #closed = false
  constructor(private accountId: string, private store: HistoryStore, private transport: LabTransport) {}
  snapshot = () => this.#snapshot
  subscribe = (fn: () => void) => { this.#listeners.add(fn); return () => { this.#listeners.delete(fn) } }
  close() { this.#closed = true; this.#listeners.clear() }
  async load() {
    try { this.#publish(await this.store.read(), 'local') }
    catch (error) { this.#error(error); throw error }
  }
  async record(events: LabEvent[]) {
    if (this.#closed) throw new Error('La sesión del laboratorio está cerrada.')
    try {
      const saved = await this.store.update(state => ({
        events: mergeEvents(this.accountId, state.events, events),
        pendingIds: [...new Set([...state.pendingIds, ...events.map(e => e.id)])],
      }))
      this.#publish(saved, 'pending')
    } catch (error) { this.#error(error); throw error }
  }
  refresh(): Promise<void> {
    if (this.#closed) return Promise.resolve()
    if (this.#running) return this.#running
    this.#running = this.#synchronize().finally(() => { this.#running = undefined })
    return this.#running
  }
  async #synchronize() {
    this.#publish(this.#snapshot, 'syncing')
    try {
      let remote: LabEvent[] = []
      for (const file of await this.transport.list()) {
        if (this.#closed) return
        remote = mergeEvents(this.accountId, remote, parseEventBatch(await this.transport.read(file.id), this.accountId).events)
      }
      if (this.#closed) return
      const combined = await this.store.update(state => ({ ...state, events: mergeEvents(this.accountId, state.events, remote) }))
      this.#publish(combined, 'syncing')
      const sending = new Set(combined.pendingIds)
      if (sending.size) {
        await this.transport.append({ schema: 1, privacy: 'tai-lab-private', accountId: this.accountId,
          events: combined.events.filter(e => sending.has(e.id)) })
        // Closing during an upload leaves the queue pending; re-upload is safe after reconnecting.
        if (this.#closed) return
      }
      const saved = await this.store.update(state => ({ ...state, pendingIds: state.pendingIds.filter(id => !sending.has(id)) }))
      this.#publish(saved, saved.pendingIds.length ? 'pending' : 'synced')
    } catch (error) { this.#error(error); throw error }
  }
  #publish(state: StoredHistory, status: LabSyncStatus) {
    if (this.#closed) return
    this.#snapshot = { events: state.events, pendingIds: state.pendingIds, status: status === 'local' && state.pendingIds.length ? 'pending' : status }
    this.#listeners.forEach(fn => fn())
  }
  #error(error: unknown) {
    if (this.#closed) return
    this.#snapshot = { ...this.#snapshot, status: 'error', error: error instanceof Error ? error.message : 'No se pudo guardar o sincronizar.' }
    this.#listeners.forEach(fn => fn())
  }
}
