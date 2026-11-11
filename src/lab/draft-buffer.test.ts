import { expect, it } from 'vitest'
import type { Draft, Exposure, LabEvent } from './model'
import { exportHistory, restoreHistory } from './history'
import { draftWriteBuffer } from './draft-buffer'
import { RevisionWriteBuffer } from './revision-buffer'

const draft = (id: string): Draft => ({ id, kind: 'draft', accountId: 'buffer-account', deviceId: 'device-a',
  createdAt: '2026-11-11T12:00:00Z', packageId: 'synthetic', packageVersion: '1', activityId: 'sql',
  activityVersion: '1', attemptGroupId: 'group', parentIds: [], value: id, position: 0 })
const deferred = () => {
  let resolve!: () => void, reject!: (reason: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

it('starts every draft write before a controller can close and flush waits for all of them', async () => {
  const buffer = new RevisionWriteBuffer<Draft>(), a = deferred(), b = deferred(), started: string[] = []
  const first = buffer.save(draft('first'), events => { started.push(events[0].id); return a.promise })
  const second = buffer.save({ ...draft('second'), parentIds: ['first'] }, events => { started.push(events[0].id); return b.promise })
  expect(started).toEqual(['first', 'second'])
  let flushed = false
  const waiting = buffer.flush().then(value => { flushed = true; return value })
  a.resolve(); expect(await first).toBe(true)
  expect(flushed).toBe(false)
  b.reject(new Error('Storage unavailable'))
  expect(await second).toBe(false)
  expect(await waiting).toBe(false)
  buffer.retry(async () => {})
  expect(await buffer.flush()).toBe(true)
  expect(buffer.snapshot().map(entry => entry.note.value)).toEqual(['first', 'second'])
})

it('keeps retained drafts separate for accounts, activities and content editions', async () => {
  const ref = draft('held'), buffer = draftWriteBuffer(ref.accountId, ref)
  await buffer.save(ref, async () => { throw new Error('Full') })
  expect(draftWriteBuffer(ref.accountId, { ...ref })).toBe(buffer)
  for (const [account, changed] of [['other', {}], [ref.accountId, { activityId: 'other' }],
    [ref.accountId, { activityVersion: '2' }], [ref.accountId, { packageVersion: '2' }]] as const) {
    expect(draftWriteBuffer(account, { ...ref, ...changed }).snapshot()).toEqual([])
  }
  buffer.acknowledge([ref])
  expect(buffer.hasUnsaved()).toBe(false)
})

const exposure = (id: string): Exposure => ({ id, kind: 'exposure', accountId: 'buffer-account',
  deviceId: 'device-a', createdAt: '2026-11-11T12:00:00Z', familyId: 'synthetic-family', reason: 'solution' })

it('retries and exports companion events with their draft after an atomic save fails', async () => {
  const buffer = new RevisionWriteBuffer<Draft>(), revision = draft('model-view'), action = exposure('model-action')
  const calls: LabEvent[][] = []
  expect(await buffer.save(revision, async events => { calls.push(events); throw new Error('Full') }, [action])).toBe(false)
  expect(calls).toEqual([[revision, action]])
  expect(restoreHistory(revision.accountId, exportHistory(revision.accountId, buffer.events()), []))
    .toEqual([action, revision])
  buffer.retry(async events => { calls.push(events) })
  expect(await buffer.flush()).toBe(true)
  expect(calls).toEqual([[revision, action], [revision, action]])
  buffer.acknowledge([revision])
  expect(buffer.events()).toEqual([revision, action])
  buffer.acknowledge([revision, action])
  expect(buffer.events()).toEqual([])
})

it('retains a companion collision through late success and downloads the original payload', async () => {
  const buffer = new RevisionWriteBuffer<Draft>(), revision = draft('view'), action = exposure('action'), pending = deferred()
  const writing = buffer.save(revision, () => pending.promise, [action])
  buffer.acknowledge([revision, { ...action, reason: 'external' }])
  expect(buffer.snapshot()[0].collision).toBe(true)
  pending.resolve()
  expect(await writing).toBe(false)
  expect(await buffer.flush()).toBe(false)
  let retried = false
  buffer.retry(async () => { retried = true })
  expect(retried).toBe(false)
  expect(restoreHistory(revision.accountId, exportHistory(revision.accountId, buffer.events()), [])).toEqual([action, revision])
})

it('freezes the submitted batch rather than retaining mutable caller objects', async () => {
  const buffer = new RevisionWriteBuffer<Draft>(), revision = draft('view'), action = exposure('action')
  const pending = deferred(), batches: LabEvent[][] = []
  const writing = buffer.save(revision, async events => { batches.push(events); await pending.promise }, [action])
  revision.value = 'changed by caller'; action.reason = 'external'
  expect((batches[0][0] as Draft).value).toBe('view')
  expect((batches[0][1] as Exposure).reason).toBe('solution')
  pending.reject(new Error('Full')); await writing
  expect((buffer.events()[0] as Draft).value).toBe('view')
})
