import { describe, expect, it } from 'vitest'
import { LearningCapture } from './learning-capture'
import { mergeEvents } from './history'
import { sampleAttempt, sampleIPv4Package, samplePackage } from './fixtures.test-support'
import type { LabEvent, LearningContext } from './model'
import { createIPv4View, planIPv4Prediction, planIPv4Reveal } from './ipv4-workflow'
import { DEFAULT_LEARNING_POLICY, deriveLearning } from './learning'

const target = { kind: 'activity' as const, packageId: 'synthetic', packageVersion: '1', activityId: 'p1', activityVersion: '1', attemptGroupId: 'group' }
const contexts = (events: LabEvent[]) => events.filter((event): event is LearningContext => event.kind === 'learning-context')
const attempt = (id: string) => ({ ...sampleAttempt(id), attemptGroupId: 'group', createdAt: new Date().toISOString() })

describe('browser learning capture boundary', () => {
  it('captures visible reference with the first presentation and retains its immutable value', async () => {
    let history: LabEvent[] = []
    const capture = new LearningCapture('account-a', 'device-a', () => history), activity = samplePackage().activities[0]
    const batch = capture.prepare(target, activity, [attempt('answer')], undefined, { referenceVisible: true })
    const p = contexts(batch).find(e => e.action === 'present')!
    expect(p).toMatchObject({ contractVersion: 2, referenceVisible: true })
    expect(batch.some(e => e.kind === 'assistance')).toBe(false)
    await capture.write(batch, async incoming => { history = mergeEvents('account-a', history, incoming) })
    expect(capture.present(target, activity).id).toBe(p.id)
    expect(contexts(history).find(e => e.id === p.id)).toEqual(p)
  })

  it('keeps a failed resize reference stable and includes it even when text is hidden before answering', async () => {
    let history: LabEvent[] = []
    const capture = new LearningCapture('account-a', 'device-a', () => history), activity = samplePackage().activities[0]
    const record = async (incoming: LabEvent[]) => { history = mergeEvents('account-a', history, incoming) }
    await capture.write(capture.present(target, activity).events, record)
    const batch = capture.reference(target, activity), original = structuredClone(batch)
    expect(contexts(batch)).toHaveLength(1)
    expect(contexts(batch)[0]).toMatchObject({ action: 'reference', factIds: [] })
    await expect(capture.write(batch, async () => { throw new Error('disk full') })).rejects.toThrow()
    expect(capture.reference(target, activity)).toEqual(original)
    const answer = capture.prepare(target, activity, [attempt('answer')])
    expect(answer).toEqual(expect.arrayContaining(original))
    expect(contexts(answer).find(e => e.action === 'answer')?.parentIds).toContain(contexts(batch)[0].id)
    await capture.write(answer, record)
    expect(contexts(history).filter(e => e.action === 'reference')).toHaveLength(1)
    expect(batch).toEqual(original)
    expect(capture.reference(target, activity)).toEqual([])
  })

  it('adds reference to a restored unanswered presentation without replacing its identity or creating exposure', async () => {
    let history: LabEvent[] = []
    const activity = samplePackage().activities[0], first = new LearningCapture('account-a', 'device-a', () => history)
    const p = first.present(target, activity)
    await first.write(p.events, async incoming => { history = mergeEvents('account-a', history, incoming) })
    const original = structuredClone(history), restored = new LearningCapture('account-a', 'device-b', () => history)
    const r = restored.present(target, activity, undefined, { referenceVisible: true })
    expect(r.id).toBe(p.id)
    expect(r.events).toHaveLength(1)
    expect(contexts(r.events)[0]).toMatchObject({ action: 'reference', presentationId: p.id, deviceId: 'device-b' })
    expect(history).toEqual(original)
    expect(restored.reference(target, activity)).toEqual(r.events)
  })

  it('keeps causal reference and original answer identity across remount and partial import', async () => {
    let history: LabEvent[] = []
    const pack = samplePackage(), activity = pack.activities[0]
    const record = async (incoming: LabEvent[]) => { history = mergeEvents('account-a', history, incoming) }
    const first = new LearningCapture('account-a', 'device-a', () => history)
    const presentation = first.present(target, activity)
    await first.write(presentation.events, record)
    const pending = first.reference(target, activity)
    await expect(first.write(pending, async () => { throw new Error('disk full') })).rejects.toThrow()
    // The external semantic buffer survives unmount and supplies pending contexts to the new capture.
    const remounted = new LearningCapture('account-a', 'device-a', () => mergeEvents('account-a', history, pending))
    const original = attempt('original-response'), originalCopy = structuredClone(original)
    const answer = remounted.prepare(target, activity, [original], undefined, { referenceVisible: false })
    expect(contexts(answer).find(e => e.action === 'answer')).toMatchObject({ presentationId: presentation.id })
    expect(contexts(answer).find(e => e.action === 'answer')?.parentIds).toContain(contexts(pending)[0].id)
    await remounted.write(answer, record)
    const derive = () => deriveLearning({ accountId: 'account-a', packages: [pack], events: history,
      now: new Date().toISOString(), policy: DEFAULT_LEARNING_POLICY }).attempts[0]
    expect(derive()).toMatchObject({ eligibility: 'uncertain', unaided: false })
    await first.write(pending, record)
    expect(derive()).toMatchObject({ eligibility: 'eligible', referenceSupport: 'recorded', unaided: false })
    expect(history.filter(e => e.kind === 'attempt')).toHaveLength(1)
    expect(history.find(e => e.kind === 'attempt')).toMatchObject(originalCopy)
    expect(original).toEqual(originalCopy)
    expect(history.filter(e => e.kind === 'exposure')).toHaveLength(1)
  })

  it('retains the same atomic presentation through replay and restores it without a new exposure', async () => {
    let history: LabEvent[] = []
    const record = async (batch: LabEvent[]) => { history = mergeEvents('account-a', history, batch) }
    const capture = new LearningCapture('account-a', 'device-a', () => history), activity = samplePackage().activities[0]
    const first = capture.present(target, activity)
    expect(capture.present(target, activity)).toEqual(first)
    await capture.write(first.events, record)
    await capture.write(first.events, record)
    expect(history).toHaveLength(2)
    const restored = new LearningCapture('account-a', 'device-b', () => history).present(target, activity)
    expect(restored).toEqual({ id: first.id, events: [] })
  })

  it('keeps an answer and its context together even before the initial presentation write finishes', async () => {
    let history: LabEvent[] = []
    const capture = new LearningCapture('account-a', 'device-a', () => history), activity = samplePackage().activities[0]
    const answer = attempt('answer'), batch = capture.prepare(target, activity, [answer])
    expect(batch).toHaveLength(4)
    expect('learningContextId' in answer).toBe(false)
    await capture.write(batch, async incoming => { history = mergeEvents('account-a', history, incoming) })
    const reply = contexts(history).find(event => event.action === 'answer')!
    expect(reply.parentIds).toContain(reply.presentationId)
    const retry = capture.prepare(target, activity, [{ ...attempt('retry'), ordinal: 2 }])
    const retryContext = contexts(retry).find(event => event.action === 'answer')!
    expect(retryContext.presentationId).toBe(reply.presentationId)
    expect(retryContext.parentIds).toContain(reply.id)
  })

  it('does not invent a confirmation after a failed write and permits a byte-identical retry', async () => {
    let history: LabEvent[] = []
    const capture = new LearningCapture('account-a', 'device-a', () => history), activity = samplePackage().activities[0]
    const batch = capture.prepare(target, activity, [attempt('answer')]), original = structuredClone(batch)
    await expect(capture.write(batch, async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
    expect(history).toEqual([])
    await capture.write(batch, async incoming => { history = mergeEvents('account-a', history, incoming) })
    expect(batch).toEqual(original)
    expect(history).toHaveLength(4)
  })

  it('does not backfill a legacy answer and does not need one parent per historical fact', () => {
    const old = attempt('old'), history: LabEvent[] = [old, ...Array.from({ length: 600 }, (_, i) => ({
      kind: 'exposure' as const, id: `old-exposure-${i}`, accountId: 'account-a', deviceId: 'device-a',
      createdAt: old.createdAt, familyId: `old-family-${i}`, reason: 'presented' as const,
    }))]
    const capture = new LearningCapture('account-a', 'device-a', () => history), activity = samplePackage().activities[0]
    const batch = capture.prepare(target, activity, [old])
    expect(batch.find(event => event.id === old.id)).toEqual(old)
    expect(contexts(batch).filter(event => event.action === 'answer')).toEqual([])
    expect(capture.warning).toContain('histórico')
    expect(contexts(capture.prepare(target, activity, [attempt('new')])).some(event => event.action === 'answer')).toBe(true)
  })

  it('uses the original IPv4 prediction context on another device without changing the deterministic attempt', async () => {
    let history: LabEvent[] = []
    const record = async (batch: LabEvent[]) => { history = mergeEvents('account-a', history, batch) }
    const activity = sampleIPv4Package().activities[0]
    if (activity.kind !== 'ipv4-model') throw new Error('Wrong fixture')
    const capture = new LearningCapture('account-a', 'device-a', () => history)
    await capture.write(capture.present(target, activity).events, record)
    const ctx = { accountId: 'account-a', deviceId: 'device-a', packageId: 'synthetic', packageVersion: '1',
      attemptGroupId: 'group', createdAt: new Date().toISOString(), activeMs: 10 }
    const view = createIPv4View(activity)
    view.prediction = { ...view.prediction, omitted: true }
    const prediction = planIPv4Prediction(activity, ctx, view, history, { predictionId: 'prediction' })
    await capture.write(capture.prepare(target, activity, prediction.events), record)
    const reveal = planIPv4Reveal(activity, { ...ctx, deviceId: 'device-b' }, prediction.view, history,
      { revealId: 'reveal', assistanceId: 'help', exposureId: 'solution' })
    const other = new LearningCapture('account-a', 'device-b', () => history)
    const batch = other.prepare(target, activity, reveal.events, 'prediction')
    expect(batch.find(event => event.kind === 'attempt')).toEqual(reveal.events.find(event => event.kind === 'attempt'))
    const help = contexts(batch).find(event => event.action === 'help')!
    expect(help.presentationId).toBe(contexts(history).find(event => event.action === 'answer')!.presentationId)
    await other.write(batch, record)
    expect(contexts(history).filter(event => event.action === 'answer')).toHaveLength(1)
  })

  it.each(['before-prediction', 'after-prediction'] as const)('anchors IPv4 textual support %s to the original answer, not reveal', async timing => {
    let history: LabEvent[] = []
    const record = async (batch: LabEvent[]) => { history = mergeEvents('account-a', history, batch) }
    const pack = sampleIPv4Package(), activity = pack.activities[0]
    if (activity.kind !== 'ipv4-model') throw new Error('Wrong fixture')
    const capture = new LearningCapture('account-a', 'device-a', () => history)
    await capture.write(capture.present(target, activity, undefined, { referenceVisible: timing === 'before-prediction' }).events, record)
    const ctx = { accountId: 'account-a', deviceId: 'device-a', packageId: 'synthetic', packageVersion: '1',
      attemptGroupId: 'group', createdAt: new Date().toISOString(), activeMs: 10 }
    const initial = createIPv4View(activity), view = { ...initial, prediction: { ...initial.prediction, omitted: true } }
    const prediction = planIPv4Prediction(activity, ctx, view, history, { predictionId: 'prediction' })
    await capture.write(capture.prepare(target, activity, prediction.events), record)
    const originalPrediction = structuredClone(history.find(e => e.id === 'prediction'))
    const other = new LearningCapture('account-a', 'device-b', () => history)
    if (timing === 'after-prediction') await other.write(other.reference(target, activity, 'prediction'), record)
    const reveal = planIPv4Reveal(activity, { ...ctx, deviceId: 'device-b', createdAt: new Date().toISOString() }, prediction.view, history,
      { revealId: 'reveal', assistanceId: 'help', exposureId: 'solution' })
    await other.write(other.prepare(target, activity, reveal.events, 'prediction'), record)
    const snapshot = deriveLearning({ accountId: 'account-a', packages: [pack], events: history, now: new Date().toISOString(), policy: DEFAULT_LEARNING_POLICY })
    expect(snapshot.attempts).toHaveLength(1)
    expect(snapshot.attempts[0]).toMatchObject({ eligibility: 'eligible', first: true,
      referenceSupport: timing === 'before-prediction' ? 'recorded' : 'none', unaided: timing !== 'before-prediction' })
    expect(history.find(e => e.id === 'prediction')).toEqual(originalPrediction)
    expect(history.find(e => e.kind === 'attempt')).toEqual(reveal.events.find(e => e.kind === 'attempt'))
  })
})
