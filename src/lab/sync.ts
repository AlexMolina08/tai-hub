import type { EventBatch, LabEvent } from './model'
import type { HistoryGeneration, HistoryStore, StoredHistory } from './store'
import { mergeEvents } from './history'
import { parseEventBatch } from './validate'

export type RemoteLabBatch = { id: string; headRevisionId?: string; generation?: string; reset?: HistoryGeneration }
export interface LabTransport {
  list(): Promise<RemoteLabBatch[]>
  read(id: string): Promise<unknown>
  append(batch: EventBatch, generation?: string): Promise<void>
  compact?(files: RemoteLabBatch[], batch: EventBatch, generation?: string): Promise<void>
  reset?(): Promise<HistoryGeneration>
}
export type LabSyncStatus = 'local' | 'pending' | 'syncing' | 'synced' | 'error'
export interface LabSnapshot extends StoredHistory { status: LabSyncStatus; error?: string }

function newest(a?: HistoryGeneration, b?: HistoryGeneration) {
  if (!a || !b) return a ?? b
  return (Date.parse(a.createdTime) - Date.parse(b.createdTime) || a.id.localeCompare(b.id)) >= 0 ? a : b
}

function applyGeneration(state: StoredHistory, remote?: HistoryGeneration): StoredHistory {
  const generation = newest(state.generation, remote)
  return generation?.id === state.generation?.id ? state : { generation, events: [], pendingIds: [] }
}

/** Immutable remote batches avoid shared-file overwrites. Duplicate uploads are harmless by event identity. */
export class LabSync {
  #snapshot: LabSnapshot = { events: [], pendingIds: [], status: 'local' }
  #listeners = new Set<() => void>()
  #running?: Promise<void>
  #resetting?: Promise<void>
  #closed = false
  #remote = new Map<string, { revision: string; events: LabEvent[] }>()
  constructor(private accountId: string, private store: HistoryStore, private transport: LabTransport) {}
  snapshot = () => this.#snapshot
  subscribe = (fn: () => void) => { this.#listeners.add(fn); return () => { this.#listeners.delete(fn) } }
  close() { this.#closed = true; this.#listeners.clear() }
  async load() {
    try { this.#publish(await this.store.read(), 'local') }
    catch (error) { this.#error(error); throw error }
  }
  async record(events: LabEvent[], expected = this.#snapshot.generation?.id ?? null) {
    if (this.#closed) throw new Error('La sesión del laboratorio está cerrada.')
    if (this.#resetting) throw new Error('El historial se está reiniciando.')
    const generation = expected ?? undefined
    try {
      const saved = await this.store.update(state => {
        if (state.generation?.id !== generation) return state
        return { ...state, events: mergeEvents(this.accountId, state.events, events),
          pendingIds: [...new Set([...state.pendingIds, ...events.map(e => e.id)])] }
      })
      if (saved.generation?.id !== generation) {
        this.#publish(saved, 'local')
        throw new Error('El historial del laboratorio se ha reiniciado.')
      }
      this.#publish(saved, 'pending')
    } catch (error) { this.#error(error); throw error }
  }
  refresh(): Promise<void> {
    if (this.#closed) return Promise.resolve()
    if (this.#resetting) return this.#resetting
    if (this.#running) {
      return this.#running.then(() => {
        // An edit may have arrived after the active pass selected its batch.
        if (this.#snapshot.pendingIds.length) return this.refresh()
      })
    }
    this.#running = this.#synchronize().finally(() => { this.#running = undefined })
    return this.#running
  }
  reset(): Promise<void> {
    if (this.#closed || !this.transport.reset) return Promise.reject(new Error('Conecta Drive para reiniciar el historial.'))
    if (!this.#resetting) this.#resetting = this.#restart(this.transport.reset).finally(() => { this.#resetting = undefined })
    return this.#resetting
  }
  async #restart(reset: () => Promise<HistoryGeneration>) {
    try {
      await this.#running?.catch(() => {})
      if (this.#closed) throw new Error('La sesión del laboratorio está cerrada.')
      const generation = await reset()
      const files = await this.transport.list()
      if (!files.some(file => file.reset?.id === generation.id)) throw new Error('Drive todavía no muestra el reinicio. Vuelve a sincronizar.')
      await this.#synchronize(files)
    } catch (error) { this.#error(error); throw error }
  }
  async #synchronize(listed?: RemoteLabBatch[]) {
    this.#publish(this.#snapshot, 'syncing')
    try {
      const listedFiles = listed ?? await this.transport.list()
      const generation = listedFiles.reduce((latest, file) => newest(latest, file.reset), this.#snapshot.generation)
      const files = listedFiles.filter(file => !file.reset && file.generation === generation?.id)
      const current = new Map<string, { revision: string; events: LabEvent[] }>()
      const incoming: LabEvent[][] = []
      for (let offset = 0; offset < files.length; offset += 6) {
        if (this.#closed) return
        const batches = await Promise.all(files.slice(offset, offset + 6).map(async file => {
          const known = this.#remote.get(file.id)
          const events = known && known.revision === file.headRevisionId
            ? known.events : parseEventBatch(await this.transport.read(file.id), this.accountId).events
          if (file.headRevisionId) current.set(file.id, { revision: file.headRevisionId, events })
          return events
        }))
        incoming.push(...batches)
      }
      if (this.#closed) return
      const remote = mergeEvents(this.accountId, incoming.flat())
      this.#remote = current
      const confirmed = new Set(remote.map(event => event.id))
      const combined = await this.store.update(previous => {
        const state = applyGeneration(previous, generation)
        if (state.generation?.id !== generation?.id) return state
        return { ...state, events: mergeEvents(this.accountId, state.events, remote),
          pendingIds: state.pendingIds.filter(id => !confirmed.has(id)) }
      })
      if (combined.generation?.id !== generation?.id) { this.#publish(combined, 'local'); return }
      this.#publish(combined, 'syncing')
      const sending = new Set(combined.pendingIds)
      if (sending.size) {
        await this.transport.append({ schema: 1, privacy: 'tai-lab-private', accountId: this.accountId,
          events: combined.events.filter(e => sending.has(e.id)) }, generation?.id)
        // Closing during an upload leaves the queue pending until the next refresh can confirm it.
        if (this.#closed) return
      }
      const saved = await this.store.update(state => state.generation?.id === generation?.id
        ? { ...state, pendingIds: state.pendingIds.filter(id => !sending.has(id)) } : state)
      this.#publish(saved, saved.pendingIds.length ? 'pending' : 'synced')
      if (saved.generation?.id === generation?.id && files.length >= 32 && remote.length && !this.#closed && this.transport.compact) {
        try {
          await this.transport.compact(files, { schema: 1, privacy: 'tai-lab-private', accountId: this.accountId, events: remote }, generation?.id)
        } catch {
          if (this.#closed) return
          this.#snapshot = { ...this.#snapshot, error: 'El progreso se conservó. No se pudo completar la compactación en Drive.' }
          this.#listeners.forEach(fn => fn())
        }
      }
    } catch (error) { this.#error(error); throw error }
  }
  #publish(state: StoredHistory, status: LabSyncStatus) {
    if (this.#closed) return
    this.#snapshot = { ...state, status: status === 'local' && state.pendingIds.length ? 'pending' : status }
    this.#listeners.forEach(fn => fn())
  }
  #error(error: unknown) {
    if (this.#closed) return
    this.#snapshot = { ...this.#snapshot, status: 'error', error: error instanceof Error ? error.message : 'No se pudo guardar o sincronizar.' }
    this.#listeners.forEach(fn => fn())
  }
}
