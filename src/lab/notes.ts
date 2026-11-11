import type { LabEvent, NoteRevision, NoteTarget } from './model'
import { LabValidationError } from './validate'

export const noteKey = (target: NoteTarget) => JSON.stringify(target.kind === 'activity'
  ? [target.kind, target.purpose, target.packageId, target.packageVersion, target.activityId, target.activityVersion]
  : [target.kind, target.purpose, target.packageId, target.packageVersion, target.sessionId, target.sessionVersion])

/** Validate known edges before storage; missing ancestors can arrive in a later batch. */
export function validateNoteHistory(events: LabEvent[]) {
  const notes = events.filter((event): event is NoteRevision => event.kind === 'note')
  const all = new Map(events.map(event => [event.id, event]))
  const incoming = new Map<string, number>(), children = new Map<string, string[]>()
  for (const note of notes) {
    let count = 0
    for (const parentId of new Set(note.parentIds)) {
      const parent = all.get(parentId)
      if (!parent) continue
      if (parent.kind !== 'note' || parent.accountId !== note.accountId || noteKey(parent.target) !== noteKey(note.target)) {
        throw new LabValidationError(['La nota referencia otra cuenta, contenido o versión.'])
      }
      count += 1
      const descendants = children.get(parentId) ?? []
      descendants.push(note.id); children.set(parentId, descendants)
    }
    incoming.set(note.id, count)
  }
  // Iterative topological traversal also handles long histories without exhausting the stack.
  const ready = notes.filter(note => incoming.get(note.id) === 0).map(note => note.id)
  for (let index = 0; index < ready.length; index += 1) {
    for (const child of children.get(ready[index]) ?? []) {
      const count = incoming.get(child)! - 1
      incoming.set(child, count)
      if (count === 0) ready.push(child)
    }
  }
  if (ready.length !== notes.length) throw new LabValidationError(['Ciclo en las revisiones de una nota.'])
}

/** Preserve unknown ancestors and concurrent heads. Clocks never select a winning note. */
export function noteHeads(events: LabEvent[], accountId: string, target: NoteTarget): NoteRevision[] {
  validateNoteHistory(events)
  const key = noteKey(target)
  const notes = events.filter((event): event is NoteRevision => event.kind === 'note' && event.accountId === accountId && noteKey(event.target) === key)
  const parents = new Set(notes.flatMap(note => note.parentIds))
  return notes.filter(note => !parents.has(note.id))
}
