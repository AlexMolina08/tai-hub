import { expect, it } from 'vitest'
import { semanticWriteBuffer } from './semantic-buffer'
import { LearningCapture } from './learning-capture'
import { sampleAttempt, samplePackage } from './fixtures.test-support'
import { exportHistory, mergeEvents } from './history'
import type { LabEvent } from './model'

it('retains the original failed response and context across remount, export and retry', async () => {
  const accountId = 'semantic-account', attempt = { ...sampleAttempt('semantic-first'), accountId, createdAt: new Date().toISOString() }
  const ref = { packageId: attempt.packageId, packageVersion: attempt.packageVersion, activityId: attempt.activityId, activityVersion: attempt.activityVersion }
  let history: LabEvent[] = []
  const capture = new LearningCapture(accountId, attempt.deviceId, () => history)
  const batch = capture.prepare({ ...ref, kind: 'activity', attemptGroupId: attempt.attemptGroupId }, samplePackage().activities[0], [attempt])
  const first = semanticWriteBuffer(accountId, ref)
  expect(await first.save(batch[0], async () => { throw new Error('Disk unavailable') }, batch.slice(1))).toBe(false)
  const remounted = semanticWriteBuffer(accountId, ref)
  expect(remounted).toBe(first)
  expect(await remounted.flush()).toBe(false)
  const exported = JSON.parse(exportHistory(accountId, remounted.events()))
  expect(exported.events.find((event: LabEvent) => event.id === attempt.id)).toMatchObject(attempt)
  remounted.retry(async incoming => { history = mergeEvents(accountId, history, incoming) })
  expect(await remounted.flush()).toBe(true)
  expect(JSON.parse(exportHistory(accountId, history))).toEqual(exported)
  remounted.acknowledge(history)
  expect(remounted.events()).toEqual([])
  expect(semanticWriteBuffer('other-account', ref).events()).toEqual([])
})

it('does not discard a semantic batch when only its attempt has arrived', async () => {
  const accountId = 'partial-semantic', attempt = { ...sampleAttempt('partial-first'), accountId, createdAt: new Date().toISOString() }
  const ref = { packageId: attempt.packageId, packageVersion: attempt.packageVersion, activityId: attempt.activityId, activityVersion: attempt.activityVersion }
  const capture = new LearningCapture(accountId, attempt.deviceId, () => [])
  const batch = capture.prepare({ ...ref, kind: 'activity', attemptGroupId: attempt.attemptGroupId }, samplePackage().activities[0], [attempt])
  const buffer = semanticWriteBuffer(accountId, ref)
  await buffer.save(batch[0], async () => { throw new Error('Interrupted') }, batch.slice(1))
  buffer.acknowledge(batch.filter(event => event.kind === 'attempt'))
  expect(buffer.events()).toEqual(batch)
  expect(buffer.hasUnsaved()).toBe(true)
  buffer.acknowledge(batch)
  expect(buffer.events()).toEqual([])
})
