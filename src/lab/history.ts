import type { Draft, EventBatch, LabEvent } from './model'
import { LabValidationError, parseEventBatch } from './validate'
import { validateNoteHistory } from './notes'
import { validateIPv4History } from './ipv4-workflow'

/** Stable serialization compares payloads, never wall clocks or insertion order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  return JSON.stringify(value)
}
export function mergeEvents(accountId: string, ...groups: LabEvent[][]): LabEvent[] {
  const merged = new Map<string, LabEvent>()
  for (const group of groups) {
    const batch = parseEventBatch({ schema: 1, privacy: 'tai-lab-private', accountId, events: group }, accountId)
    for (const event of batch.events) {
      const previous = merged.get(event.id)
      if (previous && canonical(previous) !== canonical(event)) throw new LabValidationError([`Colisión de identidad: ${event.id}. Conserva ambos archivos para revisión.`])
      merged.set(event.id, event)
    }
  }
  const events = [...merged.values()]
  validateNoteHistory(events)
  validateDraftHistory(events)
  try { validateIPv4History(events) } catch (error) { throw new LabValidationError([String(error)]) }
  return events.sort((a, b) => a.id.localeCompare(b.id))
}
export const draftKey = (d: Draft) => JSON.stringify([d.packageId, d.packageVersion, d.activityId, d.activityVersion])

/** Validate known edges before storage; missing ancestors can arrive in a later batch. */
export function validateDraftHistory(events: LabEvent[]) {
  const drafts = events.filter((event): event is Draft => event.kind === 'draft')
  const all = new Map(events.map(event => [event.id, event]))
  const incoming = new Map<string, number>(), children = new Map<string, string[]>()
  for (const draft of drafts) {
    let count = 0
    for (const parentId of new Set(draft.parentIds)) {
      const parent = all.get(parentId)
      if (!parent) continue
      if (parent.kind !== 'draft' || parent.accountId !== draft.accountId || draftKey(parent) !== draftKey(draft)) {
        throw new LabValidationError(['El borrador referencia otra cuenta, contenido o versión.'])
      }
      // An explicit resolution may join concurrent drafts from different attempt groups.
      count += 1
      const descendants = children.get(parentId) ?? []
      descendants.push(draft.id); children.set(parentId, descendants)
    }
    incoming.set(draft.id, count)
  }
  const ready = drafts.filter(draft => incoming.get(draft.id) === 0).map(draft => draft.id)
  for (let index = 0; index < ready.length; index += 1) {
    for (const child of children.get(ready[index]) ?? []) {
      const count = incoming.get(child)! - 1
      incoming.set(child, count)
      if (count === 0) ready.push(child)
    }
  }
  if (ready.length !== drafts.length) throw new LabValidationError(['Ciclo en revisiones de borrador.'])
}

/** Missing parents remain recoverable; concurrent branches never silently win. */
export function draftHeads(events: LabEvent[], key: string): Draft[] {
  validateDraftHistory(events)
  const drafts = events.filter((event): event is Draft => event.kind === 'draft' && draftKey(event) === key)
  const parents = new Set(drafts.flatMap(d => d.parentIds))
  return drafts.filter(d => !parents.has(d.id))
}
export function exportHistory(accountId: string, events: LabEvent[]): string {
  const batch: EventBatch = { schema: 1, privacy: 'tai-lab-private', accountId, events: mergeEvents(accountId, events) }
  return JSON.stringify(batch, null, 2)
}
export function restoreHistory(accountId: string, raw: string, existing: LabEvent[]): LabEvent[] {
  const imported = parseEventBatch(JSON.parse(raw), accountId)
  return mergeEvents(accountId, existing, imported.events)
}
