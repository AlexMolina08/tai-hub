import { describe, expect, it } from 'vitest'
import { LearningCapture } from './learning-capture'
import { mergeEvents } from './history'
import { sampleAttempt, sampleIPv4Package, samplePackage } from './fixtures.test-support'
import type { LabEvent, LearningContext } from './model'
import { createIPv4View, planIPv4Prediction, planIPv4Reveal } from './ipv4-workflow'

const target = { kind: 'activity' as const, packageId: 'synthetic', packageVersion: '1', activityId: 'p1', activityVersion: '1', attemptGroupId: 'group' }
const contexts = (events: LabEvent[]) => events.filter((event): event is LearningContext => event.kind === 'learning-context')
const attempt = (id: string) => ({ ...sampleAttempt(id), attemptGroupId: 'group', createdAt: new Date().toISOString() })

describe('browser learning capture boundary', () => {
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
})
