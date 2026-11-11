import { expect, it } from 'vitest'
import type { Draft, EventBatch, LabEvent } from './model'
import { draftHeads, draftKey, exportHistory, mergeEvents, restoreHistory } from './history'
import { LabSync, type LabTransport } from './sync'
import type { HistoryStore, StoredHistory } from './store'
import { sampleAttempt } from './fixtures.test-support'

const draft = (id: string, parentIds: string[] = [], changes: Partial<Draft> = {}): Draft => ({
  id, parentIds, kind: 'draft', accountId: 'account-a', deviceId: 'device-a', createdAt: '2026-11-11T12:00:00Z',
  packageId: 'synthetic', packageVersion: '1', activityId: 'p1', activityVersion: '1',
  attemptGroupId: 'group', value: id, position: 0, ...changes,
})
const batch = (events: LabEvent[]): EventBatch => ({ schema: 1, privacy: 'tai-lab-private', accountId: 'account-a', events })
const heads = (events: LabEvent[]) => draftHeads(events, draftKey(draft('reference')))
const cycle = () => [draft('cycle-a', ['cycle-b']), draft('cycle-b', ['cycle-a'])]

function setup(events: LabEvent[] = [], pendingIds: string[] = []) {
  let state: StoredHistory = structuredClone({ events, pendingIds })
  const store: HistoryStore = {
    read: async () => structuredClone(state),
    update: async change => {
      const next = change(structuredClone(state))
      state = structuredClone(next)
      return structuredClone(state)
    },
  }
  const files: EventBatch[] = [], uploads: EventBatch[] = []
  const transport: LabTransport = {
    list: async () => files.map((_, index) => ({ id: String(index) })),
    read: async id => structuredClone(files[Number(id)]),
    append: async value => { uploads.push(structuredClone(value)) },
  }
  return { store, files, uploads, sync: new LabSync('account-a', store, transport) }
}

it.each([
  ['package', { packageId: 'other' }],
  ['package edition', { packageVersion: '2' }],
  ['activity', { activityId: 'p2' }],
  ['activity edition', { activityVersion: '2' }],
] as const)('rejects a known draft parent from another %s before merge or restore', (_, change) => {
  const parent = draft('parent', [], change), child = draft('child', ['parent'])
  expect(() => mergeEvents('account-a', [parent], [child])).toThrow(/borrador.*(?:actividad|contenido|versión)/)
  expect(() => restoreHistory('account-a', JSON.stringify(batch([child])), [parent])).toThrow(/borrador/)
})

it('rejects known ancestry across accounts even when heads receive unmerged input', () => {
  const child = draft('child', ['parent']), parent = draft('parent', [], { accountId: 'account-b' })
  expect(() => heads([child, parent])).toThrow(/cuenta/)
  expect(() => mergeEvents('account-a', [child], [parent])).toThrow(/otra cuenta/)
})

it.each(['attempt', 'exposure'] as const)('rejects a %s as a draft parent without treating it as a revision', kind => {
  const parent: LabEvent = kind === 'attempt' ? sampleAttempt('parent') : {
    id: 'parent', kind: 'exposure', accountId: 'account-a', deviceId: 'device-a',
    createdAt: '2026-11-11T12:00:00Z', familyId: 'family', reason: 'presented',
  }
  expect(() => mergeEvents('account-a', [parent], [draft('child', ['parent'])])).toThrow(/borrador/)
})

it('rejects cycles within a batch and cycles completed by a later batch', () => {
  const [a, b] = cycle()
  expect(mergeEvents('account-a', [a])).toEqual([a])
  expect(() => mergeEvents('account-a', [a, b])).toThrow(/Ciclo/)
  expect(() => mergeEvents('account-a', [a], [b])).toThrow(/Ciclo/)
  expect(() => restoreHistory('account-a', JSON.stringify(batch([b])), [a])).toThrow(/Ciclo/)
})

it('keeps missing ancestors recoverable, then validates their arriving payload', () => {
  const child = draft('child', ['parent'])
  expect(heads(mergeEvents('account-a', [child]))).toEqual([child])
  expect(heads(mergeEvents('account-a', [child], [draft('parent')]))).toEqual([child])
  expect(() => mergeEvents('account-a', [child], [draft('parent', [], { activityVersion: '2' })])).toThrow(/borrador/)
})

it('retains concurrent groups and historical attempts until an explicit draft resolution', () => {
  const a = draft('left', [], { attemptGroupId: 'left-group', createdAt: '2040-01-01T00:00:00Z' })
  const b = draft('right', [], { attemptGroupId: 'right-group', createdAt: '2000-01-01T00:00:00Z' })
  const attempt = sampleAttempt('historical-attempt')
  const chosen = draft('chosen', ['left', 'right'], { attemptGroupId: b.attemptGroupId, value: b.value })
  const before = structuredClone([a, b, attempt])
  expect(new Set(heads(mergeEvents('account-a', before)))).toEqual(new Set([a, b]))
  const merged = mergeEvents('account-a', before, [chosen])
  expect(heads(merged)).toEqual([chosen])
  expect(merged.find(event => event.id === attempt.id)).toEqual(attempt)
  expect(merged.filter(event => event.kind === 'attempt')).toHaveLength(1)
  expect(before).toEqual([a, b, attempt])
  expect(restoreHistory('account-a', exportHistory('account-a', merged), [])).toEqual(merged)
})

it('handles a long valid chain in either input order and rejects a long cycle without recursion', () => {
  const chain = Array.from({ length: 15_000 }, (_, index) => draft(`d${index}`,
    index === 14_999 ? [] : [`d${index + 1}`]))
  expect(heads(chain)).toEqual([chain[0]])
  expect(heads([...chain].reverse())).toEqual([chain[0]])
  expect(heads(mergeEvents('account-a', chain))).toEqual([chain[0]])
  const cyclic = [...chain.slice(0, -1), { ...chain.at(-1)!, parentIds: [chain[0].id] }]
  expect(() => heads(cyclic)).toThrow(/Ciclo/)
})

it('keeps existing history unchanged when restore rejects invalid ancestry', () => {
  const existing = [draft('saved'), sampleAttempt()]
  const before = structuredClone(existing)
  expect(() => restoreHistory('account-a', JSON.stringify(batch(cycle())), existing)).toThrow(/Ciclo/)
  expect(existing).toEqual(before)
})

it.each(['cycle', 'cross-version'] as const)('record rejects %s before replacing local history or its pending queue', async kind => {
  const saved = draft('saved'), attempt = sampleAttempt()
  const s = setup([saved, attempt], [saved.id])
  await s.sync.load()
  const before = await s.store.read()
  const invalid = kind === 'cycle' ? cycle() : [draft('child', ['parent']), draft('parent', [], { activityVersion: '2' })]
  await expect(s.sync.record(invalid)).rejects.toThrow(/Ciclo|borrador/)
  expect(await s.store.read()).toEqual(before)
  expect(s.sync.snapshot().events).toEqual(before.events)
  expect(s.sync.snapshot().pendingIds).toEqual(before.pendingIds)
  expect(s.sync.snapshot().status).toBe('error')
  expect(s.uploads).toHaveLength(0)
  s.sync.close()
})

it.each(['cycle-between-files', 'cross-version-local-parent'] as const)('sync rejects %s without replacing or uploading local work', async kind => {
  const parent = draft('parent', [], { activityVersion: '2' })
  const local = kind === 'cycle-between-files' ? draft('saved') : parent
  const s = setup([local, sampleAttempt()], [local.id])
  await s.sync.load()
  const before = await s.store.read()
  if (kind === 'cycle-between-files') s.files.push(...cycle().map(event => batch([event])))
  else s.files.push(batch([draft('child', ['parent'])]))
  await expect(s.sync.refresh()).rejects.toThrow(/Ciclo|borrador/)
  expect(await s.store.read()).toEqual(before)
  expect(s.sync.snapshot().events).toEqual(before.events)
  expect(s.sync.snapshot().pendingIds).toEqual(before.pendingIds)
  expect(s.uploads).toHaveLength(0)
  s.sync.close()
})

it('sync accepts a matching late parent and preserves both branches without clock arbitration', async () => {
  const child = draft('child', ['parent']), sibling = draft('sibling', ['parent'], { createdAt: '2040-01-01T00:00:00Z' })
  const s = setup([child], [child.id])
  s.files.push(batch([sibling]), batch([draft('parent')]))
  await s.sync.load(); await s.sync.refresh()
  expect(new Set(heads(s.sync.snapshot().events))).toEqual(new Set([child, sibling]))
  expect(s.sync.snapshot().pendingIds).toEqual([])
  expect(s.uploads).toEqual([batch([child])])
  expect(s.sync.snapshot().events.filter(event => event.kind === 'attempt')).toEqual([])
  s.sync.close()
})
