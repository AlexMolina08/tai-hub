import { expect, it } from 'vitest'
import type { Draft } from './model'
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
