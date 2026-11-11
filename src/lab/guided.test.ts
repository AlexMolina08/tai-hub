import { expect, it } from 'vitest'
import { sampleAttempt, sampleGuidedPackage, samplePackage } from './fixtures.test-support'
import { sessionAssistance, sessionMinutes, sessionResume } from './guided'
import { exportHistory, mergeEvents, restoreHistory } from './history'
import type { Assistance, SessionPosition } from './model'
import { parseEventBatch, parsePackage } from './validate'

const position = (id = 'position-1'): SessionPosition => ({ id, kind: 'session-position', accountId: 'account-a', deviceId: 'device-a',
  createdAt: '2026-11-11T10:00:00.000Z', packageId: 'synthetic', packageVersion: '1', sessionId: 'session-1', sessionVersion: '1',
  stageId: 'experiment', activityId: 'p2', completed: false })

it('retains legacy package bytes semantically and accepts a fully gated synthetic 36-minute session', () => {
  const legacy = samplePackage(), pack = sampleGuidedPackage()
  expect(parsePackage(legacy)).toEqual(legacy)
  expect(parsePackage(pack)).toEqual(pack)
  expect(sessionMinutes(pack.sessions![0])).toBe(36)
})

it('rejects reserved content, broken readings, repeated activities and invalid stage timing', () => {
  for (const mutate of [
    (pack: ReturnType<typeof sampleGuidedPackage>) => { pack.sessions![0].stages[3].activityIds = ['r1'] },
    (pack: ReturnType<typeof sampleGuidedPackage>) => { pack.sessions![0].stages[3].activityIds = ['d1'] },
    (pack: ReturnType<typeof sampleGuidedPackage>) => { pack.sessions![0].stages[3].activityIds = ['p1'] },
    (pack: ReturnType<typeof sampleGuidedPackage>) => { pack.sessions![0].stages[1].readings[0].explanationIndexes = [100] },
    (pack: ReturnType<typeof sampleGuidedPackage>) => { pack.sessions![0].stages[0].minutes = 0 },
    (pack: ReturnType<typeof sampleGuidedPackage>) => { pack.sessions![0].stages[2].kind = 'close' },
    (pack: ReturnType<typeof sampleGuidedPackage>) => { pack.sessions![0].stages[0].activityIds = [] },
    (pack: ReturnType<typeof sampleGuidedPackage>) => { pack.sessions![0].stages[1].readings[0].explanationIndexes = [-1] },
  ]) {
    const pack = sampleGuidedPackage(); mutate(pack)
    expect(() => parsePackage(pack, 'authoring')).toThrow()
  }
})

it('requires session gates and validated dependencies instead of inheriting lesson acceptance', () => {
  const pack = sampleGuidedPackage()
  pack.evidence = pack.evidence.filter(evidence => evidence.subjectId !== 'session-1')
  expect(() => parsePackage(pack)).toThrow('puerta')
  pack.sessions![0].state = 'review'
  expect(parsePackage(pack, 'authoring').sessions![0].state).toBe('review')
  expect(() => parsePackage(pack)).toThrow('no validado')
  const broken = sampleGuidedPackage(); broken.activities[0].state = 'review'
  expect(() => parsePackage(broken, 'authoring')).toThrow('actividad todavía no validada')
  const collision = sampleGuidedPackage(); collision.sessions![0].id = 'l1'
  expect(() => parsePackage(collision)).toThrow('identidad de sesión compartida')
})

it('rejects a declared objective absent from every referenced activity and reading', () => {
  const pack = sampleGuidedPackage()
  pack.objectives.push({ ...pack.objectives[0], id: 'o2', state: 'planned' })
  pack.sessions![0].objectiveIds = ['o2']
  expect(() => parsePackage(pack, 'authoring')).toThrow('objetivo o2 sin cobertura')
})

it('reports assistance before an answer or after an unaided answer without altering the attempt', () => {
  const pack = sampleGuidedPackage(), attempt = sampleAttempt()
  const assistance: Assistance = { kind: 'assistance', id: 'help-1', accountId: 'account-a', deviceId: 'device-b',
    createdAt: '2026-11-11T11:00:00.000Z', packageId: pack.id, packageVersion: pack.version,
    activityId: 'p1', activityVersion: '1', attemptGroupId: 'a1', hintCount: 0, solutionViewed: true }
  const withoutAnswer = { ...assistance, id: 'help-2', activityId: 'p2', hintCount: 1, solutionViewed: false }
  const events = [attempt, assistance, withoutAnswer]
  const frozen = structuredClone(events)
  expect([...sessionAssistance(pack, pack.sessions![0], events, 'account-a')]).toEqual(['p1', 'p2'])
  expect(events).toEqual(frozen)
  for (const change of [{ accountId: 'other' }, { packageVersion: '2' }, { activityVersion: '2' }, { activityId: 'r1' }, { solutionViewed: false }]) {
    expect(sessionAssistance(pack, pack.sessions![0], [{ ...assistance, ...change }], 'account-a').size).toBe(0)
  }
})

it('syncs navigation as immutable account-scoped events and restores it without losing either device', () => {
  const a = position(), b = { ...position('position-2'), deviceId: 'device-b', stageId: 'transfer', activityId: 'i2' }
  const merged = mergeEvents('account-a', [a], [b], [a])
  expect(merged).toHaveLength(2)
  expect(restoreHistory('account-a', exportHistory('account-a', merged), [a])).toEqual(merged)
  expect(sessionResume([sampleGuidedPackage()], merged, 'account-a')?.position).toEqual(b)
  expect(() => restoreHistory('account-b', exportHistory('account-a', merged), [])).toThrow('otra cuenta')
  expect(() => mergeEvents('account-a', [a], [{ ...a, stageId: 'close' }])).toThrow('Colisión')
})

it('does not resurrect older unfinished navigation after session completion', () => {
  const first = position(), completed = { ...position('finished'), createdAt: '2026-11-11T11:00:00.000Z', stageId: 'close', activityId: null, completed: true }
  expect(sessionResume([sampleGuidedPackage()], [completed, first], 'account-a')).toBeUndefined()
  const resumed = { ...position('reopened'), createdAt: '2026-11-11T12:00:00.000Z' }
  expect(sessionResume([sampleGuidedPackage()], [completed, first, resumed], 'account-a')?.position).toEqual(resumed)
})

it('ignores unavailable editions, invalid locations and other accounts without changing history', () => {
  const pack = sampleGuidedPackage(), event = position()
  for (const change of [{ accountId: 'other' }, { packageVersion: '2' }, { sessionVersion: '2' }, { stageId: 'missing' },
    { activityId: 'r1' }, { activityId: 'i1' }, { completed: true }]) {
    expect(sessionResume([pack], [{ ...event, ...change }], 'account-a')).toBeUndefined()
  }
  const input = [event, { ...event, id: 'future', sessionVersion: '2', createdAt: '2026-11-12T10:00:00.000Z' }]
  const frozen = structuredClone(input)
  expect(sessionResume([pack], input, 'account-a')?.position).toEqual(event)
  expect(input).toEqual(frozen)
  pack.sessions![0].state = 'review'
  expect(sessionResume([pack], input, 'account-a')).toBeUndefined()
})

it('rejects malformed session positions before persisting or importing them', () => {
  for (const change of [{ activityId: 5 }, { completed: 'yes' }, { sessionVersion: '' }, { stageId: '' }]) {
    expect(() => parseEventBatch({ schema: 1, privacy: 'tai-lab-private', accountId: 'account-a', events: [{ ...position(), ...change }] }, 'account-a')).toThrow()
  }
})
