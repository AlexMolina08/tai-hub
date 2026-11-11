import { expect, it } from 'vitest'
import type { Activity, Assistance, Attempt, Exposure, LabEvent, LabPackage, LearningTarget } from './model'
import { DEFAULT_LEARNING_POLICY, deriveLearning } from './learning'
import { preparedDiagnosticIds } from './grading'
import { captureLearningClock, planLearningContext } from './learning-context'
import { mergeEvents } from './history'
import { sampleAttempt, samplePackage } from './fixtures.test-support'

const START = Date.parse('2026-11-01T00:00:00Z'), DAY = 86400000
function fixture() {
  const pack = samplePackage(); let events: LabEvent[] = [], serial = 0
  const clock = (date: string, session = 'clock-a', mono = Date.parse(date) - START) => captureLearningClock(date, session, mono, 'Europe/Madrid')
  function add(activityId: string, date: string, changes: Partial<Attempt> = {}, from: LabEvent[] = events) {
    const a = pack.activities.find(a => a.id === activityId)!, id = `answer-${++serial}`, createdAt = new Date(Date.parse(date) + 1000).toISOString()
    const group = `group-${serial}`, target: LearningTarget = { kind: 'activity', packageId: pack.id, packageVersion: pack.version,
      activityId: a.id, activityVersion: a.version, attemptGroupId: group }
    const exposure: Exposure = { kind: 'exposure', id: id + '-exposure', accountId: 'account-a', deviceId: 'device-a', createdAt: date, familyId: a.familyId, reason: 'presented' }
    const p = planLearningContext({ id: id + '-presentation', action: 'present', target, presentationId: null, studySessionId: date.slice(0, 10),
      clock: clock(date), facts: [exposure], history: from })
    const before = mergeEvents('account-a', from, p.events)
    const attempt: Attempt = { ...sampleAttempt(id), createdAt, activityId: a.id, activityVersion: a.version, familyId: a.familyId,
      objectiveIds: a.objectiveIds, phase: a.phase, attemptGroupId: group, ...changes }
    const answer = planLearningContext({ id: id + '-context', action: 'answer', target, presentationId: id + '-presentation', studySessionId: date.slice(0, 10),
      clock: clock(createdAt), facts: [attempt], history: before })
    events = mergeEvents('account-a', events, before, answer.events)
    return { id, target, presentationId: id + '-presentation', contextId: id + '-context', before, answer, attempt }
  }
  function help(target: LearningTarget, presentationId: string, date: string, from = events) {
    if (target.kind !== 'activity') throw new Error('fixture')
    const fact: Assistance = { ...target, kind: 'assistance', id: `help-${++serial}`, accountId: 'account-a', deviceId: 'device-a', createdAt: date,
      hintCount: 1, solutionViewed: false }
    const plan = planLearningContext({ id: fact.id + '-context', action: 'help', target, presentationId, studySessionId: date.slice(0, 10),
      clock: clock(date), facts: [fact], history: from })
    events = mergeEvents('account-a', events, plan.events)
    return plan
  }
  const result = (now = '2026-11-30T12:00:00Z', packages: LabPackage[] = [pack]) => deriveLearning({ accountId: 'account-a', packages, events,
    now, policy: DEFAULT_LEARNING_POLICY })
  return { pack, add, help, result, clock, get events() { return events }, set events(e) { events = e } }
}
const objective = (f: ReturnType<typeof fixture>) => f.result().objectives[0]

function referenceFixture() {
  const pack = samplePackage(), activity = pack.activities.find(a => a.id === 'i1')!
  let events: LabEvent[] = []
  const target: LearningTarget = { kind: 'activity', packageId: pack.id, packageVersion: pack.version,
    activityId: activity.id, activityVersion: activity.version, attemptGroupId: 'reference-group' }
  const base = (id: string, second: number, deviceId = 'device-a') => ({ id, accountId: 'account-a', deviceId,
    createdAt: new Date(Date.parse('2026-11-02T10:00:00Z') + second * 1000).toISOString() })
  const clock = (second: number, device = 'device-a') => captureLearningClock(base('clock', second).createdAt, 'clock-' + device, second * 1000, 'UTC')
  const append = (plan: ReturnType<typeof planLearningContext>) => { events = mergeEvents('account-a', events, plan.events); return plan }
  const present = (visible = false) => append(planLearningContext({ id: 'p', action: 'present', target, presentationId: null,
    studySessionId: 'study', clock: clock(1), history: events, referenceVisible: visible,
    facts: [{ ...base('exposure', 1), kind: 'exposure', familyId: activity.familyId, reason: 'presented' }] }))
  const read = (second = 2, from = events, lessonId = 'l1', packageVersion = '1', device = 'device-a') => append(planLearningContext({
    id: 'reading', action: 'reading', target: { kind: 'lesson', packageId: pack.id, packageVersion, lessonId, lessonVersion: '1' },
    presentationId: null, studySessionId: 'study-' + device, clock: clock(second, device), history: from, facts: [], base: base('read', second, device) }))
  const reference = (second = 2, from = events) => append(planLearningContext({ id: 'reference', action: 'reference', target, presentationId: 'p',
    studySessionId: 'study', clock: clock(second), history: from, facts: [], base: base('ref', second) }))
  const answer = (id = 'answer', second = 3) => append(planLearningContext({ id: id + '-context', action: 'answer', target, presentationId: 'p',
    studySessionId: 'study', clock: clock(second), history: events,
    facts: [{ ...sampleAttempt(id), ...base(id, second), activityId: activity.id, familyId: activity.familyId, phase: activity.phase,
      attemptGroupId: 'reference-group', ordinal: id === 'answer' ? 1 : 2 }] }))
  const result = () => deriveLearning({ accountId: 'account-a', packages: [pack], events, now: '2026-11-03T12:00:00Z', policy: DEFAULT_LEARNING_POLICY })
  return { pack, present, read, reference, answer, result, get events() { return events }, set events(value) { events = value } }
}

it('counts explicit visible reference as support without changing solution, hints or family exposure', () => {
  const f = referenceFixture(); f.present(true); f.answer()
  expect(f.result().attempts[0]).toMatchObject({ referenceSupport: 'recorded', unaided: false, understanding: false, eligibility: 'eligible' })
  expect(f.events.filter(e => e.kind === 'exposure')).toHaveLength(1)
  expect(f.events.some(e => e.kind === 'assistance')).toBe(false)
  expect(f.events.find(e => e.kind === 'attempt')).toMatchObject({ hintCount: 0, solutionViewed: false, outcome: 'correct' })
})

it.each(['reading', 'reference', 'other-device'] as const)('recognizes causal %s support between presentation and answer', kind => {
  const f = referenceFixture(); f.present()
  if (kind === 'reference') f.reference()
  else f.read(2, f.events, 'l1', '1', kind === 'other-device' ? 'device-b' : 'device-a')
  f.answer()
  expect(f.result().attempts[0]).toMatchObject({ referenceSupport: 'recorded', first: true, unaided: false, understanding: false })
})

it('keeps earlier study as preparation and does not taint an answer by later reading or reference', () => {
  const prior = referenceFixture(); prior.read(0); prior.present(); prior.answer()
  expect(prior.result().attempts[0]).toMatchObject({ referenceSupport: 'none', unaided: true, understanding: true })
  const later = referenceFixture(); later.present(); later.answer(); later.read(4); later.reference(5)
  expect(later.result().attempts[0]).toMatchObject({ referenceSupport: 'none', unaided: true, understanding: true })
  later.answer('retry', 6)
  expect(later.result().attempts.find(a => a.attemptId === 'retry')).toMatchObject({ first: false, referenceSupport: 'recorded', unaided: false })
})

it.each(['presentation', 'answer', 'reference'] as const)('does not invent an order for support concurrent with %s', branch => {
  const f = referenceFixture(); f.present(); const before = f.events
  if (branch === 'presentation') { f.read(0, []); f.answer() }
  else { f.answer(); if (branch === 'reference') f.reference(2, before); else f.read(2, before) }
  expect(f.result().attempts[0]).toMatchObject({ eligibility: 'uncertain', referenceSupport: 'uncertain', unaided: false, understanding: false })
})

it('scopes reading to exact package edition and related objectives', () => {
  const unrelated = referenceFixture()
  unrelated.pack.lessons.push({ ...unrelated.pack.lessons[0], id: 'other', objectiveIds: ['unrelated-objective'] })
  unrelated.present(); unrelated.read(2, unrelated.events, 'other'); unrelated.answer()
  expect(unrelated.result().attempts[0]).toMatchObject({ referenceSupport: 'none', unaided: true })
  const edition = referenceFixture(); edition.present(); edition.read(2, edition.events, 'l1', 'other-edition'); edition.answer()
  expect(edition.result().attempts[0]).toMatchObject({ referenceSupport: 'none', unaided: true })
})

it('withholds absence-of-support claims for missing references and v1 captures without backfill', () => {
  const missing = referenceFixture(); missing.present(); missing.read(); missing.answer()
  missing.events = missing.events.filter(e => e.id !== 'reading')
  expect(missing.result().attempts[0]).toMatchObject({ eligibility: 'uncertain', unaided: false, understanding: false })
  const old = referenceFixture(); old.present(); old.answer()
  old.events = old.events.map(e => {
    if (e.kind !== 'learning-context') return e
    const { referenceVisible: _referenceVisible, ...rest } = e
    return { ...rest, contractVersion: 1 as const }
  })
  const original = JSON.stringify(old.events)
  expect(old.result().attempts[0]).toMatchObject({ eligibility: 'uncertain', referenceSupport: 'uncertain', unaided: false, first: true })
  expect(old.result().attempts[0].reasons.some(r => r.code === 'legacy-reference-unknown')).toBe(true)
  expect(JSON.stringify(old.events)).toBe(original)
})
function consolidated() {
  const f = fixture()
  f.add('p1', '2026-11-02T10:00:00Z'); f.add('p2', '2026-11-02T10:10:00Z'); f.add('d1', '2026-11-04T10:20:00Z')
  return f
}

it('derives the full 3/2/2 rule offline with one delayed fresh answer satisfying both dimensions', () => {
  const f = consolidated(), o = objective(f)
  expect(o.status).toBe('consolidated')
  expect(o.requirements).toMatchObject({ correct: { actual: 3 }, families: { actual: 3 }, days: { actual: 2 }, delayed: true, freshTransfer: true })
  expect(o.retentionIds).toEqual(o.transferIds)
  expect(o.schedule).toMatchObject({ intervalDays: 3, dueAt: '2026-11-07T10:20:01.000Z', timeStatus: 'declared-device' })
  expect(f.result().timeBasis).toBe('declared-device')
})

it('is deterministic under import order, duplicate batches and a frozen now', () => {
  const f = consolidated(), input = { accountId: 'account-a', packages: [f.pack], now: '2026-11-05T00:00:00Z', policy: DEFAULT_LEARNING_POLICY }
  expect(deriveLearning({ ...input, events: [...f.events].reverse().concat(f.events) })).toEqual(deriveLearning({ ...input, events: f.events }))
})

it('preserves historical attempts without fabricating prospective evidence or dates', () => {
  const f = fixture(); f.events = [sampleAttempt()]
  const out = f.result()
  expect(out.attempts[0]).toMatchObject({ eligibility: 'historical', timeStatus: 'historical', first: false, retention: false, transfer: false })
  expect(out.objectives[0].qualifyingCorrectIds).toEqual([])
  expect(f.events).toEqual([sampleAttempt()])
})

it.each(['annulled', 'disputed', 'unreconciled'] as const)('excludes %s provenance from all mastery evidence', status => {
  const f = consolidated(); f.pack.activities.find(a => a.id === 'd1')!.provenance.status = status
  expect(objective(f).status).not.toBe('consolidated')
  expect(f.result().attempts.find(a => a.ref.activityId === 'd1')?.eligibility).toBe('excluded')
})

it('separates accounts and exact package editions without rewriting prior outcomes', () => {
  const f = consolidated(), other = structuredClone(f.pack); other.version = '2'
  const out = f.result(undefined, [other])
  expect(out.objectives[0].qualifyingCorrectIds).toEqual([])
  expect(deriveLearning({ accountId: 'other', packages: [f.pack], events: f.events, now: '2026-11-30T00:00:00Z', policy: DEFAULT_LEARNING_POLICY }).attempts).toEqual([])
  expect(f.events.filter(e => e.kind === 'attempt').every(e => e.outcome === 'correct')).toBe(true)
})

it('does not retroactively turn a first answer into helped when help was requested afterwards', () => {
  const f = fixture(), a = f.add('p1', '2026-11-02T10:00:00Z')
  f.help(a.target, a.presentationId, '2026-11-02T10:01:00Z')
  expect(f.result().attempts[0]).toMatchObject({ first: true, unaided: true, understanding: true })
})

it('does not infer the order of a concurrent hint from wall clocks', () => {
  const f = fixture(), a = f.add('p1', '2026-11-02T10:00:00Z')
  f.help(a.target, a.presentationId, '2026-11-02T10:00:00.500Z', a.before)
  expect(f.result().attempts[0]).toMatchObject({ eligibility: 'uncertain', unaided: false, understanding: false })
})

it('first omission and all later retries stay distinct; a retry does not become a first answer', () => {
  const f = fixture(), a = f.add('p1', '2026-11-02T10:00:00Z', { answer: null, outcome: 'omitted' })
  const retry = { ...a.attempt, id: 'retry', ordinal: 2, answer: 'a', outcome: 'correct' as const, createdAt: '2026-11-02T10:02:00Z' }
  const plan = planLearningContext({ id: 'retry-context', action: 'answer', target: a.target, presentationId: a.presentationId, studySessionId: 'same',
    clock: f.clock(retry.createdAt), facts: [retry], history: f.events })
  f.events = mergeEvents('account-a', f.events, plan.events)
  expect(f.result().attempts.find(a => a.attemptId === 'retry')).toMatchObject({ first: false, understanding: false })
  expect(objective(f).reviews).toEqual([])
})

it('does not inflate mastery by reopening the same activity in new groups on one day', () => {
  const f = fixture(); f.add('p1', '2026-11-02T10:00:00Z'); f.add('p1', '2026-11-02T10:10:00Z'); f.add('p1', '2026-11-02T10:20:00Z')
  expect(objective(f).qualifyingCorrectIds).toHaveLength(1)
  expect(objective(f).understandingIds).toHaveLength(1)
})

it('treats aliases and duplicate originals as exposure, not a renamed fresh reserve', () => {
  const f = fixture(); f.add('p1', '2026-11-02T10:00:00Z'); f.add('r1', '2026-11-04T10:00:00Z')
  const out = deriveLearning({ accountId: 'account-a', packages: [f.pack], events: f.events, now: '2026-11-05T00:00:00Z', policy: DEFAULT_LEARNING_POLICY,
    equivalences: { families: [['f-p1', 'f-r1']] } })
  expect(out.attempts.find(a => a.ref.activityId === 'r1')).toMatchObject({ freshness: 'exposed', transfer: false })
})

it('marks late external exposure without causality as uncertainty instead of fresh transfer', () => {
  const f = consolidated(); f.events = [...f.events, { kind: 'exposure', id: 'external', accountId: 'account-a', deviceId: 'other',
    familyId: 'f-d1', reason: 'external', createdAt: '2026-11-01T00:00:00Z' }]
  expect(f.result().attempts.find(a => a.ref.activityId === 'd1')).toMatchObject({ freshness: 'uncertain', transfer: false })
  expect(objective(f).status).not.toBe('consolidated')
})

it('retention can revisit a known family but never becomes transfer', () => {
  const f = fixture(), d = f.pack.activities.find(a => a.id === 'd1')!
  d.evaluationIntent = 'retention'; d.familyId = 'f-p1'; d.scenarioId = 's-p1'
  f.add('p1', '2026-11-02T10:00:00Z'); f.add('d1', '2026-11-04T10:00:00Z')
  expect(f.result().attempts.find(a => a.ref.activityId === 'd1')).toMatchObject({ retention: true, transfer: false })
})

it('an intervening reading resets the retention interval without claiming completed reading', () => {
  const f = fixture(); f.add('p1', '2026-11-02T10:00:00Z')
  const date = '2026-11-04T09:55:00Z'
  const reading = planLearningContext({ id: 'reading', action: 'reading', target: { kind: 'lesson', packageId: 'synthetic', packageVersion: '1', lessonId: 'l1', lessonVersion: '1' },
    presentationId: null, studySessionId: 'read', facts: [], history: f.events, clock: f.clock(date), base: { accountId: 'account-a', deviceId: 'device-a', createdAt: date } })
  f.events = mergeEvents('account-a', f.events, reading.events); f.add('d1', '2026-11-04T10:00:00Z')
  expect(f.result().attempts.find(a => a.ref.activityId === 'd1')?.retention).toBe(false)
})

it('future clocks and wall/monotonic contradictions do not supply consolidation days', () => {
  const f = consolidated(), out = f.result('2026-11-03T00:00:00Z')
  expect(out.attempts.find(a => a.ref.activityId === 'd1')?.timeStatus).toBe('uncertain')
  expect(out.objectives[0].requirements.days.actual).toBe(1)
  const edited = f.events.map(e => e.kind === 'learning-context' && e.action === 'answer'
    ? { ...e, clock: { ...e.clock, monotonicMs: 0 } } : e)
  const bad = deriveLearning({ accountId: 'account-a', packages: [f.pack], events: edited, now: '2026-11-30T00:00:00Z', policy: DEFAULT_LEARNING_POLICY })
  expect(bad.contacts.filter(c => c.contextId.endsWith('-context')).every(c => !c.usableTime)).toBe(true)
  expect(bad.objectives[0].status).not.toBe('consolidated')
})

it('a later coherent contact bounds an old clock discontinuity without rewriting it', () => {
  const f = fixture(); f.add('p1', '2026-11-02T10:00:00Z')
  const read = (id: string, date: string, session: string, monotonic: number) => {
    const reading = planLearningContext({ id, action: 'reading',
      target: { kind: 'lesson', packageId: f.pack.id, packageVersion: f.pack.version, lessonId: 'l1', lessonVersion: '1' },
      presentationId: null, studySessionId: id, facts: [], history: f.events, clock: f.clock(date, session, monotonic),
      base: { accountId: 'account-a', deviceId: 'device-a', createdAt: date } })
    f.events = mergeEvents('account-a', f.events, reading.events)
  }
  read('clock-jump', '2026-11-03T10:00:00Z', 'clock-a', 0)
  const uncertain = f.result().contacts.find(c => c.contextId === 'clock-jump')!
  expect(uncertain.usableTime).toBe(false)
  read('new-anchor', '2026-11-05T10:00:00Z', 'new-clock', 0)
  f.add('d1', '2026-11-08T10:00:00Z')
  f.events = f.events.map(event => event.kind === 'learning-context' && event.target.kind === 'activity' && event.target.activityId === 'd1'
    ? { ...event, clock: { ...event.clock, clockSessionId: 'new-clock', monotonicMs: Date.parse(event.createdAt) - Date.parse('2026-11-05T10:00:00Z') } } : event)
  expect(f.result().attempts.find(a => a.ref.activityId === 'd1')?.retention).toBe(true)
  expect(objective(f).schedule?.timeStatus).toBe('declared-device')
  expect(f.result().contacts.find(c => c.contextId === 'clock-jump')).toEqual(uncertain)
})

it('an uncertain latest contact still prevents a delayed answer from earning retention', () => {
  const f = fixture(); f.add('p1', '2026-11-02T10:00:00Z')
  const date = '2026-11-03T10:00:00Z'
  const reading = planLearningContext({ id: 'last-jump', action: 'reading',
    target: { kind: 'lesson', packageId: f.pack.id, packageVersion: f.pack.version, lessonId: 'l1', lessonVersion: '1' },
    presentationId: null, studySessionId: 'jump', facts: [], history: f.events, clock: f.clock(date, 'clock-a', 0),
    base: { accountId: 'account-a', deviceId: 'device-a', createdAt: date } })
  f.events = mergeEvents('account-a', f.events, reading.events)
  f.add('d1', '2026-11-08T10:00:00Z')
  expect(f.result().attempts.find(a => a.ref.activityId === 'd1')?.retention).toBe(false)
})

it('a clock jump at presentation cannot supply days or retention through a coherent answer one second later', () => {
  const f = consolidated()
  const delayed = f.events.filter(event => event.kind === 'learning-context' && event.target.kind === 'activity' && event.target.activityId === 'd1')
  const first = delayed.find(event => event.kind === 'learning-context' && event.action === 'present')!
  const previous = f.events.find(event => event.kind === 'learning-context' && event.id === 'answer-2-context')!
  if (previous.kind !== 'learning-context') throw new Error('fixture')
  f.events = f.events.map(event => delayed.includes(event) && event.kind === 'learning-context'
    ? { ...event, clock: { ...event.clock, monotonicMs: previous.clock.monotonicMs + (event.id === first.id ? 1000 : 2000) } } : event)
  const result = f.result(), answer = result.attempts.find(a => a.ref.activityId === 'd1')!
  expect(answer).toMatchObject({ timeStatus: 'uncertain', retention: false })
  expect(answer.reasons.some(reason => reason.code === 'clock-session-uncertain')).toBe(true)
  expect(result.objectives[0].requirements.days.actual).toBe(1)
  expect(result.objectives[0].status).not.toBe('consolidated')
})

it('changing calendar date around midnight cannot substitute for 24 hours', () => {
  const f = fixture(); f.add('p1', '2026-11-02T22:58:00Z'); f.add('p2', '2026-11-02T23:02:00Z')
  expect(objective(f).requirements.days.actual).toBe(1)
})

it('reopens after error without deleting old evidence and requires targeted critical recovery', () => {
  const f = consolidated(), p1 = f.pack.activities[0]
  p1.learning = { diagnostics: [{ id: 'critical', objectiveIds: ['o1'], severity: 'critical', choiceOptionIds: ['b'] }], rechecksDiagnosticIds: [] }
  f.pack.activities.find(a => a.id === 'p2')!.learning = { diagnostics: [], rechecksDiagnosticIds: ['critical'] }
  f.pack.activities.find(a => a.id === 'd1')!.learning = { diagnostics: [], rechecksDiagnosticIds: ['critical'] }
  expect(preparedDiagnosticIds(p1, 'b')).toEqual(['critical'])
  const e = f.add('p1', '2026-11-05T10:00:00Z', { outcome: 'incorrect', answer: 'b', diagnosticIds: ['critical'] })
  expect(objective(f)).toMatchObject({ status: 'review-open', schedule: { intervalDays: 1 } })
  f.add('p2', '2026-11-06T10:00:00Z'); f.add('d1', '2026-11-08T10:05:00Z')
  expect(objective(f).reviews.find(r => r.attemptId === e.id)).toMatchObject({ open: false, severity: 'critical' })
  expect(objective(f).status).toBe('consolidated')
  expect(f.events.some(v => v.kind === 'attempt' && v.id === e.id && v.outcome === 'incorrect')).toBe(true)
})

it('unknown errors are ordinary observations; notes and feedback never invent a critical diagnosis', () => {
  const f = fixture(); f.add('p1', '2026-11-02T10:00:00Z', { outcome: 'incorrect', answer: 'b', feedback: 'critical severe dangerous' })
  expect(objective(f).reviews).toMatchObject([{ severity: 'ordinary', diagnosticId: null, open: true }])
})

it('exposes only exact eligible content contacts for recommendation reuse', () => {
  const f = consolidated(); const changed = structuredClone(f.pack); changed.activities[0].state = 'review'
  const out = f.result(undefined, [changed])
  expect(out.contacts.filter(c => c.contextId.startsWith('answer-1')).every(c => !c.usableTime)).toBe(true)
  const different = structuredClone(f.pack); different.version = '2'
  expect(f.result(undefined, [different]).contacts.every(c => !c.usableTime && c.objectiveIds.length === 0)).toBe(true)
})

it('requires both first answers to remain ambiguous when two devices answer the same presentation', () => {
  const f = fixture(), a = f.add('p1', '2026-11-02T10:00:00Z')
  const other: Attempt = { ...a.attempt, id: 'other-answer', deviceId: 'device-b', answer: 'b', outcome: 'incorrect' }
  const plan = planLearningContext({ id: 'other-context', action: 'answer', target: a.target, presentationId: a.presentationId, studySessionId: 'other',
    clock: captureLearningClock(other.createdAt, 'clock-b', 0, 'Europe/Madrid'), facts: [other], history: a.before })
  f.events = mergeEvents('account-a', f.events, plan.events)
  expect(f.result().attempts.every(a => a.eligibility === 'uncertain' && !a.first)).toBe(true)
  expect(objective(f).status).toBe('review-open')
})

it('keeps objective evidence independent when duplicate originals have different objective coverage', () => {
  const f = fixture(), second = { ...f.pack.objectives[0], id: 'o2', statement: 'Second synthetic objective' }
  f.pack.objectives.push(second)
  f.pack.activities.find(a => a.id === 'p2')!.objectiveIds = ['o1', 'o2']
  f.pack.activities.find(a => a.id === 'p1')!.provenance.originalId = 'same-original'
  f.pack.activities.find(a => a.id === 'p2')!.provenance.originalId = 'same-original'
  const a = f.add('p1', '2026-11-02T10:00:00Z'), b = f.add('p2', '2026-11-02T10:10:00Z')
  const out = f.result()
  expect(out.objectives.find(o => o.objectiveId === 'o1')!.qualifyingCorrectIds).toEqual([a.id])
  expect(out.objectives.find(o => o.objectiveId === 'o2')!.qualifyingCorrectIds).toEqual([b.id])
  expect(out.attempts.find(a => a.attemptId === b.id)!.understandingObjectiveIds).toEqual(['o2'])
})

it('walks 1/3/7/14/30 and saturates without advancing on early retrieval', () => {
  const f = fixture(), date = (day: number) => new Date(Date.parse('2026-11-02T10:00:00Z') + day * DAY).toISOString()
  f.add('p1', date(0)); expect(objective(f).schedule?.intervalDays).toBe(1)
  f.add('d1', date(2)); expect(objective(f).schedule?.intervalDays).toBe(3)
  f.add('d1', date(3)); expect(objective(f).schedule?.intervalDays).toBe(3)
  f.add('d1', date(7)); expect(objective(f).schedule?.intervalDays).toBe(7)
  f.add('d1', date(15)); expect(objective(f).schedule?.intervalDays).toBe(14)
  f.add('d1', date(30))
  expect(f.result('2027-12-01T00:00:00Z').objectives[0].schedule?.intervalDays).toBe(30)
  f.add('d1', date(61))
  expect(f.result('2027-12-01T00:00:00Z').objectives[0].schedule?.intervalDays).toBe(30)
})

it('keeps the interval stage after omission, schedules a next-day retry and never labels omission incorrect', () => {
  const f = consolidated(); f.add('d1', '2026-11-05T10:00:00Z', { outcome: 'omitted', answer: null })
  expect(objective(f).schedule).toMatchObject({ intervalDays: 3, nextDelayDays: 1, dueAt: '2026-11-06T10:00:01.000Z' })
  expect(objective(f).reviews).toEqual([])
})

it('a helped correct answer resets the next interval without inventing a critical error', () => {
  const f = consolidated(); f.add('p1', '2026-11-05T10:00:00Z', { hintCount: 1 })
  expect(objective(f).schedule?.intervalDays).toBe(1)
  expect(objective(f).reviews).toEqual([])
})

it('a later new error prevents a recovery pair from silently clearing the earlier error', () => {
  const f = consolidated(), first = f.add('p1', '2026-11-05T10:00:00Z', { outcome: 'incorrect', answer: 'b' })
  f.add('p2', '2026-11-06T10:00:00Z')
  f.add('i1', '2026-11-07T10:00:00Z', { outcome: 'incorrect', answer: 'b' })
  f.add('d1', '2026-11-09T10:00:00Z')
  expect(objective(f).reviews.find(r => r.attemptId === first.id)?.open).toBe(true)
})

it('an unknown grading edition cannot silently supply current mastery', () => {
  const f = fixture(); f.add('p1', '2026-11-02T10:00:00Z', { gradingVersion: 'choice-v999' })
  expect(f.result().attempts[0].eligibility).toBe('excluded')
  expect(objective(f).qualifyingCorrectIds).toEqual([])
})

it('distinguishes a missing newly referenced context from an uninstrumented historical attempt', () => {
  const f = fixture(), a = f.add('p1', '2026-11-02T10:00:00Z')
  f.events = f.events.filter(e => e.id !== a.contextId)
  expect(f.result().attempts[0]).toMatchObject({ eligibility: 'uncertain', timeStatus: 'uncertain', contextId: null })
  expect(objective(f).qualifyingCorrectIds).toEqual([])
})

it('a late legacy aid in the same group cannot be silently ordered after a newly captured answer', () => {
  const f = fixture(), a = f.add('p1', '2026-11-02T10:00:00Z')
  if (a.target.kind !== 'activity') throw new Error('fixture')
  f.events = [...f.events, { ...a.target, kind: 'assistance', id: 'legacy-help', accountId: 'account-a', deviceId: 'old-device',
    createdAt: '2026-11-20T10:00:00Z', hintCount: 1, solutionViewed: false }]
  expect(f.result().attempts[0]).toMatchObject({ eligibility: 'uncertain', unaided: false, understanding: false })
  expect(objective(f).qualifyingCorrectIds).toEqual([])
})

it('derives learning from the supported SQL graders while keeping unknown grading versions excluded', () => {
  const f = fixture()
  const a = f.pack.activities[0]
  f.pack.activities[0] = { ...a, kind: 'sql', starter: 'SELECT 1', referenceQuery: 'SELECT 1', comparison: 'bag',
    datasets: [{ id: 'one', setup: 'SELECT 1' }, { id: 'two', setup: 'SELECT 2' }] }
  f.add(a.id, '2026-11-04T09:00:00Z', { gradingVersion: 'sql-datasets-v1' })
  f.add(a.id, '2026-11-04T10:00:00Z', { gradingVersion: 'sql-datasets-v2' })
  f.add(a.id, '2026-11-04T11:00:00Z', { gradingVersion: 'sql-datasets-v3' })
  f.add(a.id, '2026-11-04T12:00:00Z', { gradingVersion: 'unrecognized' })
  expect(f.result().attempts.map(attempt => attempt.eligibility)).toEqual(['eligible', 'eligible', 'eligible', 'excluded'])
})
