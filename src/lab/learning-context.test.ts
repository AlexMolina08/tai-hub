import { describe, expect, it } from 'vitest'
import type { Exposure, LabEvent, LearningContext, LearningTarget } from './model'
import { captureLearningClock, learningFrontier, learningPresentation, planLearningContext, validateLearningHistory } from './learning-context'
import { exportHistory, mergeEvents, restoreHistory } from './history'
import { parseEventBatch, parsePackage } from './validate'
import { sampleAttempt, sampleIPv4Package, samplePackage } from './fixtures.test-support'
import { createIPv4View, planIPv4Prediction, planIPv4Reveal } from './ipv4-workflow'

const at = '2026-11-11T10:00:00.000Z'
const base = { accountId: 'account-a', deviceId: 'device-a', createdAt: at }
const target: LearningTarget = { kind: 'activity', packageId: 'synthetic', packageVersion: '1', activityId: 'p1', activityVersion: '1', attemptGroupId: 'g' }
const clock = () => captureLearningClock(at, 'clock-1', 100, 'Europe/Madrid')
const present = (id = 'present', history: LabEvent[] = []) => planLearningContext({ id, action: 'present', target, presentationId: null,
  studySessionId: 'session', clock: clock(), facts: [{ ...base, id: id + '-exposure', kind: 'exposure', familyId: 'f-p1', reason: 'presented' }], history })
function answered() {
  const p = present()
  const attempt = { ...sampleAttempt('answer'), attemptGroupId: 'g' }
  const a = planLearningContext({ id: 'answer-context', action: 'answer', target, presentationId: 'present',
    studySessionId: 'session', clock: clock(), facts: [attempt], history: p.events })
  return { p, a, events: mergeEvents('account-a', p.events, a.events) }
}
const context = (events: LabEvent[], id: string) => events.find((e): e is LearningContext => e.kind === 'learning-context' && e.id === id)!

it('captures declared local day/zone including daylight saving without a server', () => {
  expect(clock()).toMatchObject({ day: '2026-11-11', offsetMinutes: 60, zone: 'Europe/Madrid' })
  expect(captureLearningClock('2026-07-11T23:30:00Z', 'summer', 0, 'Europe/Madrid')).toMatchObject({ day: '2026-07-12', offsetMinutes: 120 })
  expect(() => captureLearningClock(at, 'x', 0, 'Invalid/Zone')).toThrow()
})

it('keeps reciprocal immutable facts and one atomic batch without mutating caller input', () => {
  const attempt = { ...sampleAttempt('answer'), attemptGroupId: 'g' }, p = present()
  const a = planLearningContext({ id: 'a-context', action: 'answer', target, presentationId: 'present', studySessionId: 'session',
    clock: clock(), facts: [attempt], history: p.events })
  expect(attempt.learningContextId).toBeUndefined()
  expect(a.events[0]).toMatchObject({ id: 'answer', learningContextId: 'a-context' })
  const merged = mergeEvents('account-a', p.events, a.events, a.events)
  expect(merged).toHaveLength(4)
  expect(restoreHistory('account-a', exportHistory('account-a', merged), [])).toEqual(merged)
})

it('captures v2 reference availability without rewriting the supported v1 format', () => {
  const { events } = answered()
  expect(context(events, 'present')).toMatchObject({ contractVersion: 2, referenceVisible: false })
  const legacy = events.map(e => {
    if (e.kind !== 'learning-context') return e
    const { referenceVisible: _referenceVisible, ...rest } = e
    return { ...rest, contractVersion: 1 as const }
  })
  const original = JSON.stringify(legacy)
  expect(restoreHistory('account-a', exportHistory('account-a', legacy), [])).toEqual(mergeEvents('account-a', legacy))
  expect(JSON.stringify(legacy)).toBe(original)
  const spoof = legacy.map(e => e.kind === 'learning-context' && e.action === 'present' ? { ...e, referenceVisible: false } : e)
  expect(() => mergeEvents('account-a', spoof)).toThrow(/incompatible/)
})

it('records reference access for an exact presentation without a solution, hint or family exposure', () => {
  const p = present()
  const r = planLearningContext({ id: 'reference', action: 'reference', target, presentationId: 'present', studySessionId: 'session',
    clock: clock(), facts: [], history: p.events, base })
  expect(r.events).toHaveLength(1)
  expect(r.context).toMatchObject({ contractVersion: 2, action: 'reference', factIds: [], parentIds: ['present'], presentationId: 'present' })
  expect(mergeEvents('account-a', p.events, r.events)).toHaveLength(3)
  expect(() => mergeEvents('account-a', p.events, r.events.map(e => ({ ...e, contractVersion: 1 })) as LabEvent[])).toThrow(/incompatible/)
  expect(() => mergeEvents('account-a', p.events, r.events.map(e => e.kind === 'learning-context'
    ? { ...e, target: { ...target, attemptGroupId: 'another' } } : e) as LabEvent[])).toThrow(/Presentación/)
  expect(() => mergeEvents('account-a', p.events, r.events.map(e => e.kind === 'learning-context'
    ? { ...e, factIds: ['present-exposure'] } : e))).toThrow(/incompletos/)
})

it('never wraps a historical response with new metadata', () => {
  const old = sampleAttempt('old'), p = present()
  const plan = planLearningContext({ id: 'new-context', action: 'answer', target, presentationId: 'present', studySessionId: 'session',
    clock: clock(), facts: [old], history: [old, ...p.events] })
  expect(plan.status).toBe('historical'); expect(plan.events).toEqual([old])
  const { events } = answered()
  const fact = events.find(e => e.kind === 'attempt')!
  expect(() => mergeEvents('account-a', events.map(e => e.id === fact.id ? { ...old, id: fact.id, attemptGroupId: 'g' } : e))).toThrow()
})

it('ignores unbounded legacy history in the frontier and degrades only for genuinely excessive branches', () => {
  const old = Array.from({ length: 1000 }, (_, i) => sampleAttempt(`old-${i}`))
  expect(learningFrontier(old, 'account-a')).toEqual([])
  expect(present('new', old).status).toBe('captured')
  const branches = Array.from({ length: 257 }, (_, i) => present(`branch-${i}`).events).flat()
  const plan = present('degraded', branches)
  expect(plan.status).toBe('historical'); expect(plan.events).toHaveLength(1)
  expect((plan.events[0] as Exposure).learningContextId).toBeUndefined()
})

it('reuses only an unanswered unique presentation and exposes concurrency without a date winner', () => {
  const p = present()
  expect(learningPresentation(p.events, 'account-a', target)).toMatchObject({ status: 'pending', presentation: { id: 'present' } })
  expect(learningPresentation(answered().events, 'account-a', target).status).toBe('answered')
  const concurrent = present('other')
  expect(learningPresentation([...p.events, ...concurrent.events], 'account-a', target).status).toBe('ambiguous')
  expect(learningPresentation(p.events, 'account-b', target).status).toBe('none')
})

it('treats missing causal facts as pending and does not restart an incompletely received answer', () => {
  const { events } = answered(), partial = events.filter(e => e.kind !== 'attempt')
  expect(validateLearningHistory(partial).missingIds).toContain('answer')
  expect(learningPresentation(partial, 'account-a', target).status).toBe('ambiguous')
  expect(mergeEvents('account-a', partial, events.filter(e => e.kind === 'attempt'))).toEqual(events)
})

it.each(['accountId', 'deviceId', 'createdAt', 'packageVersion', 'attemptGroupId'] as const)('rejects known cross-%s references before merge', key => {
  const { events } = answered()
  const changed = events.map(e => e.kind === 'attempt' ? { ...e, [key]: key === 'createdAt' ? '2026-11-12T10:00:00Z' : 'other' } : e)
  expect(() => mergeEvents('account-a', changed)).toThrow()
})

it('rejects a late parent with wrong kind and a cycle completed by a later import', () => {
  const p = present(), c = context(p.events, 'present')
  const first = { ...c, parentIds: ['missing'] }
  expect(mergeEvents('account-a', [...p.events.filter(e => e.kind !== 'learning-context'), first])).toHaveLength(2)
  expect(() => mergeEvents('account-a', [first], [sampleAttempt('missing')])).toThrow(/Padre/)
  const other = present('missing'), second = { ...context(other.events, 'missing'), parentIds: ['present'] }
  expect(() => mergeEvents('account-a', [first, second])).toThrow(/Ciclo/)
})

it('traverses long causal chains iteratively', () => {
  const { referenceVisible: _referenceVisible, ...seed } = context(present().events, 'present')
  const contexts: LearningContext[] = Array.from({ length: 15000 }, (_, i) => ({ ...seed, id: `c${i}`, action: 'reading',
    target: { kind: 'lesson', packageId: 'synthetic', packageVersion: '1', lessonId: 'l1', lessonVersion: '1' }, factIds: [],
    parentIds: i ? [`c${i - 1}`] : [] }))
  expect(validateLearningHistory(contexts).incompleteContextIds).toEqual([])
  expect(learningFrontier(contexts, 'account-a')).toEqual(['c14999'])
})

it.each([
  { clock: { ...clock(), day: '2026-11-12' } },
  { clock: { ...clock(), offsetMinutes: 0 } },
  { clock: { ...clock(), monotonicMs: -1 } },
  { contractVersion: 3 }, { referenceVisible: undefined }, { parentIds: ['present'] }, { unknown: true },
])('rejects malformed new context %j while retaining the original batch', change => {
  const p = present(); const before = JSON.stringify(p.events)
  const mutated = p.events.map(e => e.kind === 'learning-context' ? { ...e, ...change } : e)
  expect(() => parseEventBatch({ schema: 1, privacy: 'tai-lab-private', accountId: 'account-a', events: mutated }, 'account-a')).toThrow()
  expect(JSON.stringify(p.events)).toBe(before)
})

it('supports prepared diagnostics without interpreting free text', () => {
  const pack = samplePackage()
  pack.activities[0].learning = { diagnostics: [{ id: 'critical-x', objectiveIds: ['o1'], severity: 'critical', choiceOptionIds: ['b'] }], rechecksDiagnosticIds: [] }
  pack.activities[1].learning = { diagnostics: [], rechecksDiagnosticIds: ['critical-x'] }
  expect(parsePackage(pack)).toEqual(pack)
  pack.activities[0].learning.diagnostics[0].choiceOptionIds = ['a']
  expect(() => parsePackage(pack)).toThrow(/diagnóstico/)
  const attempt = { ...sampleAttempt(), diagnosticIds: ['critical-x'] }
  expect(() => mergeEvents('account-a', [attempt])).toThrow(/incorrecto/)
})

describe('IPv4 learning context', () => {
  it('attaches answer context to prediction and leaves the deterministic revealed Attempt unchanged', () => {
    const activity = sampleIPv4Package().activities[0]
    if (activity.kind !== 'ipv4-model') throw new Error('fixture')
    const p = present(), action = { ...base, packageId: 'synthetic', packageVersion: '1', attemptGroupId: 'g', activeMs: 1000 }
    const initial = createIPv4View(activity), view = { ...initial, prediction: { ...initial.prediction, omitted: true } }
    const prediction = planIPv4Prediction(activity, action, view, p.events, { predictionId: 'prediction' })
    const learned = planLearningContext({ id: 'prediction-context', action: 'answer', target, presentationId: 'present',
      studySessionId: 'session', clock: clock(), facts: prediction.events, history: p.events })
    const history = mergeEvents('account-a', p.events, learned.events)
    const reveal = planIPv4Reveal(activity, action, prediction.view, history, { revealId: 'reveal', assistanceId: 'help', exposureId: 'solution' })
    const help = planLearningContext({ id: 'help-context', action: 'help', target, presentationId: 'present',
      studySessionId: 'session', clock: clock(), facts: reveal.events, history })
    expect(help.events.find(e => e.kind === 'attempt')).toEqual(reveal.events.find(e => e.kind === 'attempt'))
    expect(mergeEvents('account-a', history, help.events).filter(e => e.kind === 'attempt')).toHaveLength(1)
  })
})
