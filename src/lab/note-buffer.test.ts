import { expect, it } from 'vitest'
import type { LabEvent, NoteRevision, NoteTarget } from './model'
import { NoteWriteBuffer, noteWriteBuffer } from './note-buffer'
import { noteHeads } from './notes'

const target: NoteTarget = { kind: 'activity', purpose: 'prediction', packageId: 'synthetic-buffer', packageVersion: '1', activityId: 'a', activityVersion: '1' }
const note = (id: string, parentIds: string[] = []): NoteRevision => ({ id, kind: 'note', target, parentIds, value: id,
  accountId: 'account-a', deviceId: 'device-a', createdAt: '2026-11-11T12:00:00.000Z' })
const deferred = () => {
  let resolve!: () => void, reject!: (reason: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

it('retains a late failure without subscribers, then retries through the new writer', async () => {
  const buffer = new NoteWriteBuffer(), write = deferred(), first = note('late')
  const stop = buffer.subscribe(() => {})
  let started = false
  buffer.save(first, () => { started = true; return write.promise })
  expect(started).toBe(true)
  stop(); write.reject(new Error('Storage unavailable')); await flush()
  expect(buffer.snapshot()).toEqual([{ note: first, status: 'failed', error: 'Storage unavailable' }])
  expect(buffer.hasUnsaved()).toBe(true)
  const saved: LabEvent[] = []
  buffer.retry(async events => { saved.push(...events) }); await flush()
  expect(saved).toEqual([first])
  expect(buffer.hasUnsaved()).toBe(false)
  expect(buffer.snapshot()[0].status).toBe('saved')
  buffer.acknowledge(saved)
  expect(buffer.snapshot()).toEqual([])
})

it('retains failed ancestors when a later child succeeds, and retries all failures atomically', async () => {
  const buffer = new NoteWriteBuffer(), writes = [deferred(), deferred(), deferred()]
  const parent = note('parent'), child = note('child', ['parent']), last = note('last', ['child'])
  ;[parent, child, last].forEach((event, i) => buffer.save(event, () => writes[i].promise))
  writes[2].resolve(); writes[0].reject(new Error('First failed')); writes[1].reject(new Error('Second failed')); await flush()
  buffer.acknowledge([last])
  expect(buffer.snapshot().map(entry => entry.note)).toEqual([parent, child])
  expect(noteHeads([last, ...buffer.snapshot().map(entry => entry.note)], 'account-a', target)).toEqual([last])
  const saved: LabEvent[] = []
  buffer.retry(async events => { saved.push(...events) }); await flush()
  expect(saved).toEqual([parent, child])
  buffer.acknowledge(saved)
  expect(buffer.snapshot()).toEqual([])
})

it('does not overwrite a later note when acknowledgements arrive in reverse order', async () => {
  const buffer = new NoteWriteBuffer(), a = deferred(), b = deferred()
  const first = note('first'), second = note('second', ['first'])
  buffer.save(first, () => a.promise); buffer.save(second, () => b.promise)
  b.resolve(); await flush(); a.resolve(); await flush()
  expect(noteHeads(buffer.snapshot().map(entry => entry.note), 'account-a', target)).toEqual([second])
  buffer.acknowledge([second]); expect(buffer.snapshot()[0].note).toEqual(first)
  buffer.acknowledge([first, second]); expect(buffer.snapshot()).toEqual([])
})

it('scopes retained writes to the account and exact target, including empty text', async () => {
  const buffer = noteWriteBuffer('account-a', target), write = deferred()
  buffer.save({ ...note('empty'), value: '' }, () => write.promise)
  expect(noteWriteBuffer('account-a', { ...target })).toBe(buffer)
  expect(noteWriteBuffer('account-b', target).snapshot()).toEqual([])
  expect(noteWriteBuffer('account-a', { ...target, activityVersion: '2' }).snapshot()).toEqual([])
  write.reject(new Error('Full')); await flush()
  expect(buffer.snapshot()[0].note.value).toBe('')
  buffer.acknowledge([{ ...note('empty'), value: '' }])
})

it('retains identity collisions and ignores late callbacks until the exact event is observed', async () => {
  const buffer = new NoteWriteBuffer(), write = deferred(), local = note('collision')
  buffer.save(local, () => write.promise)
  buffer.acknowledge([{ ...local, value: 'different stored payload' }])
  expect(buffer.snapshot()[0]).toMatchObject({ note: local, status: 'failed', collision: true })
  write.resolve(); await flush()
  expect(buffer.hasUnsaved()).toBe(true)
  expect(buffer.snapshot()[0].collision).toBe(true)
  let called = false
  buffer.retry(async () => { called = true }); await flush()
  expect(called).toBe(false)
  buffer.acknowledge([local])
  expect(buffer.snapshot()).toEqual([])
})
