import { expect, it } from 'vitest'
import { sampleAttempt, samplePackage } from './fixtures.test-support'
import { studyContinuation } from './continuation'
import type { Draft, LabEvent } from './model'

it('resumes the saved activity from another device without treating a correct answer as mastery', () => {
  const pack = samplePackage()
  const event = { ...sampleAttempt('remote', 'other-device'), activityId: 'p2', familyId: 'f-p2' }
  expect(studyContinuation([pack], [event], 'account-a')).toEqual({ pack, lesson: pack.lessons[0],
    activity: pack.activities[1], activityIndex: 1, savedAt: event.createdAt })
})

it('ignores other accounts, absent versions, reserved content and withdrawn activities', () => {
  const pack = samplePackage(), base = sampleAttempt()
  for (const change of [{ accountId: 'other' }, { packageVersion: '2' }, { activityVersion: '2' },
    { activityId: 'r1' }, { activityId: 'd1' }, { activityId: 'absent' }]) {
    expect(studyContinuation([pack], [{ ...base, ...change }], 'account-a')).toBeUndefined()
  }
  pack.lessons[0].activityIds.push('r1', 'd1')
  expect(studyContinuation([pack], [{ ...base, activityId: 'r1' }], 'account-a')).toBeUndefined()
  pack.activities[0].state = 'withdrawn'
  expect(studyContinuation([pack], [base], 'account-a')).toBeUndefined()
})

it('uses stable event ordering without changing the history or resolving conflicting drafts', () => {
  const pack = samplePackage(), base = sampleAttempt()
  const draft: Draft = { id: 'draft-z', kind: 'draft', accountId: base.accountId, deviceId: 'remote',
    createdAt: base.createdAt, packageId: pack.id, packageVersion: pack.version, activityId: 'p2', activityVersion: '1',
    attemptGroupId: 'group', parentIds: [], value: 'b', position: 0 }
  const events: LabEvent[] = [draft, base, { ...draft, id: 'draft-a', value: 'a' }]
  const snapshot = structuredClone(events)
  expect(studyContinuation([pack], events, 'account-a')?.activity.id).toBe('p2')
  expect(studyContinuation([pack], [...events].reverse(), 'account-a')?.activity.id).toBe('p2')
  expect(events).toEqual(snapshot)
})

it('skips newer unavailable work and can resume a hint shown before an answer', () => {
  const pack = samplePackage(), base = sampleAttempt()
  const events: LabEvent[] = [
    { ...base, id: 'missing', packageId: 'missing', createdAt: '2026-11-12T10:00:00.000Z' },
    { kind: 'assistance', id: 'hint', deviceId: 'remote', accountId: base.accountId,
      createdAt: base.createdAt, packageId: pack.id, packageVersion: pack.version, activityId: 'i2', activityVersion: '1',
      attemptGroupId: 'hint-group', hintCount: 0, solutionViewed: true },
  ]
  expect(studyContinuation([pack], events, 'account-a')?.activity.id).toBe('i2')
  expect(studyContinuation([], events, 'account-a')).toBeUndefined()
})
