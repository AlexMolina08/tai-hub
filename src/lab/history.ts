import type { Draft, EventBatch, LabEvent } from './model'
import { LabValidationError, parseEventBatch } from './validate'

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
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id))
}
export const draftKey = (d: Draft) => JSON.stringify([d.packageId, d.packageVersion, d.activityId, d.activityVersion])

/** Missing parents remain recoverable; unrelated, cyclic or duplicate branches never silently win. */
export function draftHeads(events: LabEvent[], key: string): Draft[] {
  const drafts = events.filter((e): e is Draft => e.kind === 'draft' && draftKey(e) === key)
  const known = new Map(drafts.map(d => [d.id, d]))
  const all = new Map(events.map(e => [e.id, e]))
  const visited = new Set<string>()
  const path = new Set<string>()
  const visit = (id: string) => {
    if (path.has(id)) throw new LabValidationError(['Ciclo en revisiones de borrador.'])
    if (visited.has(id)) return
    path.add(id)
    for (const parent of known.get(id)?.parentIds ?? []) {
      if (all.has(parent) && !known.has(parent)) throw new LabValidationError(['El borrador referencia otra actividad o versión.'])
      visit(parent)
    }
    path.delete(id)
    visited.add(id)
  }
  drafts.forEach(d => visit(d.id))
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
