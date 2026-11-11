import { expect, it } from 'vitest'
import { sampleAttempt, samplePackage } from './fixtures.test-support'
import { captureLearningClock, planLearningContext } from './learning-context'
import { DEFAULT_LEARNING_POLICY, deriveLearning } from './learning'
import { recommendLearning } from './recommendation'
import type { Draft, Exposure, LabEvent } from './model'

function pending(activityId: 'r1' | 'd1', value = '') {
  const pack = samplePackage(), activity = pack.activities.find(activity => activity.id === activityId)!
  const date = '2026-11-11T10:00:00.000Z'
  const draft: Draft = { kind: 'draft', id: 'draft', accountId: 'account-a', deviceId: 'device-a', createdAt: date,
    packageId: pack.id, packageVersion: pack.version, activityId, activityVersion: activity.version,
    attemptGroupId: 'original-group', parentIds: [], value, position: 0 }
  const exposure: Exposure = { kind: 'exposure', id: 'exposure', accountId: draft.accountId, deviceId: draft.deviceId,
    createdAt: date, familyId: activity.familyId, reason: 'presented' }
  const presentation = planLearningContext({ id: 'presentation', action: 'present',
    target: { kind: 'activity', packageId: pack.id, packageVersion: pack.version, activityId, activityVersion: activity.version,
      attemptGroupId: draft.attemptGroupId }, presentationId: null, facts: [exposure], history: [], studySessionId: 'study',
    clock: captureLearningClock(date, 'clock', 0, 'Europe/Madrid') })
  const events = [draft, ...presentation.events]
  const queue = (history: LabEvent[] = events) => recommendLearning({ packages: [pack], events: history,
    learning: deriveLearning({ packages: [pack], events: history, accountId: draft.accountId,
      now: '2026-11-11T11:00:00.000Z', policy: DEFAULT_LEARNING_POLICY }) })
  return { pack, activity, draft, events, queue }
}

it.each(['r1', 'd1'] as const)('resumes an opened %s with no lesson or answer in the original group', id => {
  const f = pending(id)
  expect(f.queue().items[0]).toMatchObject({ reason: 'resume', target: { kind: 'activity', activityId: id, attemptGroupId: 'original-group' } })
  expect(f.queue([...f.events].reverse()).items[0]).toEqual(f.queue().items[0])
})

it('does not offer an unpresented empty draft, an answered group or a missing edition as unfinished work', () => {
  const f = pending('r1')
  expect(f.queue([f.draft]).items.some(item => item.reason === 'resume')).toBe(false)
  const answer = { ...sampleAttempt(), activityId: f.activity.id, activityVersion: f.activity.version,
    phase: f.activity.phase, familyId: f.activity.familyId, attemptGroupId: f.draft.attemptGroupId }
  expect(f.queue([...f.events, answer]).items.some(item => item.reason === 'resume')).toBe(false)
  expect(f.queue([{ ...f.draft, value: 'b', activityVersion: 'unavailable' }]).items.some(item => item.reason === 'resume')).toBe(false)
})
