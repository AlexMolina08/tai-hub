import { expect, it } from 'vitest'
import type { NoteRevision, NoteTarget } from './model'
import { noteHeads } from './notes'
import { exportHistory, mergeEvents, restoreHistory } from './history'
import { parseEventBatch } from './validate'
import { sampleGuidedPackage } from './fixtures.test-support'
import { studyContinuation } from './continuation'
import { sessionAssistance, sessionResume } from './guided'

const target: NoteTarget = { kind: 'activity', purpose: 'prediction', packageId: 'synthetic', packageVersion: '1', activityId: 'p1', activityVersion: '1' }
const note = (id: string, parentIds: string[] = [], value = id): NoteRevision => ({ id, parentIds, value, kind: 'note', target,
  accountId: 'account-a', deviceId: 'device-a', createdAt: '2026-11-11T12:00:00.000Z' })

it('exports and restores note revisions with the existing account history without changing older data', () => {
  const first = note('one'), second = note('two', ['one'])
  const events = mergeEvents('account-a', [first], [second], [first])
  expect(restoreHistory('account-a', exportHistory('account-a', events), [first])).toEqual(events)
  expect(noteHeads(events, 'account-a', target)).toEqual([second])
  expect(() => restoreHistory('account-b', exportHistory('account-a', events), [])).toThrow('otra cuenta')
  expect(() => mergeEvents('account-a', events, [{ ...first, value: 'changed' }])).toThrow('Colisión')
})

it('keeps concurrent notes regardless of time or text equality until an explicit merge revision', () => {
  const first = note('one'), a = note('a', ['one'], 'same'), b = { ...note('b', ['one'], 'same'), deviceId: 'device-b', createdAt: '2040-01-01T00:00:00.000Z' }
  for (const events of [[first, a, b], [b, a, first]]) expect(new Set(noteHeads(events, 'account-a', target))).toEqual(new Set([a, b]))
  const chosen = note('chosen', ['a', 'b'], 'same')
  const events = mergeEvents('account-a', [first, a, b], [chosen])
  expect(events).toHaveLength(4)
  expect(noteHeads(events, 'account-a', target)).toEqual([chosen])
})

it('keeps missing ancestors recoverable and converges when remote batches arrive out of order', () => {
  const first = note('one'), second = note('two', ['one']), third = note('three', ['two'])
  expect(noteHeads([third], 'account-a', target)).toEqual([third])
  expect(noteHeads([third, first], 'account-a', target)).toEqual([third, first])
  expect(noteHeads([third, first, second], 'account-a', target)).toEqual([third])
})

it('rejects cross-content, cross-version, cross-account and cyclic ancestry without picking a winner', () => {
  const child = note('child', ['parent'])
  for (const parent of [
    { ...note('parent'), target: { ...target, activityId: 'p2' } },
    { ...note('parent'), target: { ...target, packageVersion: '2' } },
    { ...note('parent'), accountId: 'other' },
  ]) expect(() => noteHeads([child, parent], 'account-a', target)).toThrow('otra cuenta, contenido o versión')
  expect(() => noteHeads([note('a', ['b']), note('b', ['a'])], 'account-a', target)).toThrow('Ciclo')
})

it('keeps predictions and session reflections separate and scopes each exact edition', () => {
  const reflection: NoteRevision = { ...note('reflection'), target: { kind: 'session', purpose: 'reflection', packageId: 'synthetic', packageVersion: '1', sessionId: 'session-1', sessionVersion: '1' } }
  const prediction = note('prediction'), events = [reflection, prediction]
  const frozen = structuredClone(events)
  expect(noteHeads(events, 'account-a', target)).toEqual([prediction])
  expect(noteHeads(events, 'account-a', reflection.target)).toEqual([reflection])
  expect(noteHeads(events, 'account-b', target)).toEqual([])
  expect(noteHeads(events, 'account-a', { ...target, activityVersion: '2' })).toEqual([])
  expect(events).toEqual(frozen)
})

it('rejects malformed or oversized notes before writing them', () => {
  for (const change of [{ value: 'x'.repeat(4001) }, { value: 5 }, { parentIds: ['bad'] }, { parentIds: [5] },
    { target: { ...target, purpose: 'reflection' } }, { target: { ...target, activityVersion: '' } }, { target: null }]) {
    const invalid = { ...note('bad'), ...change }
    expect(() => parseEventBatch({ schema: 1, privacy: 'tai-lab-private', accountId: 'account-a', events: [invalid] }, 'account-a')).toThrow()
  }
  expect(parseEventBatch({ schema: 1, privacy: 'tai-lab-private', accountId: 'account-a', events: [note('empty', [], ''), note('limit', [], 'x'.repeat(4000))] }, 'account-a').events).toHaveLength(2)
})

it('does not treat a personal note as an answer, assistance or navigation event', () => {
  const pack = sampleGuidedPackage(), events = [note('prediction')]
  expect(studyContinuation([pack], events, 'account-a')).toBeUndefined()
  expect(sessionResume([pack], events, 'account-a')).toBeUndefined()
  expect(sessionAssistance(pack, pack.sessions![0], events, 'account-a').size).toBe(0)
})

it('rejects invalid known ancestry during merge and restore before changing stored history', () => {
  const existing = [note('root')], frozen = structuredClone(existing)
  const invalid = [
    [note('a', ['b']), note('b', ['a'])],
    [note('child', ['parent']), { ...note('parent'), target: { ...target, activityVersion: '2' } }],
  ]
  for (const events of invalid) {
    expect(() => mergeEvents('account-a', existing, events)).toThrow()
    expect(() => restoreHistory('account-a', JSON.stringify({ schema: 1, privacy: 'tai-lab-private', accountId: 'account-a', events }), existing)).toThrow()
    expect(existing).toEqual(frozen)
  }
  const orphan = mergeEvents('account-a', [note('child', ['absent'])])
  expect(() => mergeEvents('account-a', orphan, [{ ...note('absent'), target: { ...target, activityVersion: '2' } }])).toThrow()
  expect(orphan).toEqual([note('child', ['absent'])])
})

it('accepts a long valid chain in reverse order without depending on the call stack', () => {
  const chain = Array.from({ length: 20000 }, (_, i) => note('chain-' + i, i ? ['chain-' + (i - 1)] : []))
  const merged = mergeEvents('account-a', [...chain].reverse())
  expect(noteHeads(merged, 'account-a', target)).toEqual([chain.at(-1)])
})
