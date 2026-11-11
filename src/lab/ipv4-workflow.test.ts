import { describe, expect, it } from 'vitest'
import { DEFAULT_INPUT, MODEL_VERSION, type IPv4Prediction } from './ipv4'
import type { Attempt, Draft, EventBatch, IPv4ModelActivity, IPv4PredictionEvent, LabEvent } from './model'
import { sampleAttempt, samplePackage } from './fixtures.test-support'
import { createIPv4View, editIPv4View, ipv4DraftValue, parseIPv4View, planIPv4Prediction, planIPv4Reset,
  planIPv4Reveal, readIPv4Workflow, serializeIPv4View, validateIPv4History, ipv4AttemptId, type IPv4ActionContext } from './ipv4-workflow'
import { parseEventBatch, parsePackage } from './validate'
import { exportHistory, mergeEvents, restoreHistory } from './history'
import { LabSync, type LabTransport } from './sync'
import type { HistoryStore, StoredHistory } from './store'

const activity = (): IPv4ModelActivity => ({ ...samplePackage().activities[0], kind: 'ipv4-model', phase: 'practice',
  mode: { kind: 'simulation', engine: 'tai-ipv4-block', version: MODEL_VERSION, limits: 'Synthetic numeric model' }, initialInput: { ...DEFAULT_INPUT } })
const ctx: IPv4ActionContext = { accountId: 'account-a', deviceId: 'device-a', createdAt: '2026-11-11T12:00:00Z',
  packageId: 'synthetic', packageVersion: '1', attemptGroupId: 'group', activeMs: 1200 }
const prediction: IPv4Prediction = { omitted: false, lower: '192.168.20.64', upper: '192.168.20.127', member: 'yes', interpretationNote: 'Nota sin calificar.' }
const ids = { revealId: 'reveal', assistanceId: 'help', exposureId: 'exposure' }
const batch = (events: LabEvent[]): EventBatch => ({ schema: 1, privacy: 'tai-lab-private', accountId: ctx.accountId, events })
function sequence(patch: Partial<IPv4Prediction> = {}, input = { ...DEFAULT_INPUT }) {
  const a = { ...activity(), initialInput: input }
  const editing = editIPv4View(createIPv4View(a), { prediction: { ...prediction, ...patch } })
  const predicted = planIPv4Prediction(a, ctx, editing, [], { predictionId: 'prediction' })
  const revealed = planIPv4Reveal(a, { ...ctx, activeMs: 9999 }, predicted.view, predicted.events, ids)
  return { a, editing, predicted, revealed, events: [...predicted.events, ...revealed.events], attempt: revealed.events[0] as Attempt }
}
const draft = (view: ReturnType<typeof createIPv4View>, id = 'draft'): Draft => ({ ...ctx, id, kind: 'draft',
  activityId: 'p1', activityVersion: '1', parentIds: [], position: 0, ...ipv4DraftValue(view) })

describe('bounded IPv4 views and fixed package contract', () => {
  it('accepts only the practice modality and exact model engine/version', () => {
    const pack = samplePackage(); pack.activities[0] = activity()
    expect(parsePackage(pack)).toEqual(pack)
    for (const changed of [{ phase: 'immediate' }, { phase: 'reserved' }, { phase: 'delayed' },
      { mode: { ...activity().mode, kind: 'real' } }, { mode: { ...activity().mode, version: 'future' } },
      { mode: { ...activity().mode, engine: 'other' } }, { initialInput: { ...DEFAULT_INPUT, value: '33' } }]) {
      expect(() => parsePackage({ ...pack, activities: [{ ...activity(), ...changed }, ...pack.activities.slice(1)] })).toThrow()
    }
  })
  it('retains invalid intermediate input, isolates copies and clears locked predictions on editing', () => {
    const a = activity(), start = createIPv4View(a)
    const next = editIPv4View(start, { input: { address: '192.' } })
    expect(parseIPv4View(serializeIPv4View(next))).toEqual(next)
    expect(start.input.address).toBe(DEFAULT_INPUT.address)
    expect(a.initialInput.address).toBe(DEFAULT_INPUT.address)
    expect(() => planIPv4Prediction(a, ctx, next, [], { predictionId: 'x' })).toThrow()
    const s = sequence(), edit = editIPv4View(s.revealed.view, { input: { value: '25' } })
    expect(edit.phase).toBe('editing'); expect(edit.predictionId).toBeNull(); expect(edit.revealId).toBeNull()
    expect(edit.prediction.lower).toBe(''); expect(edit.prediction.interpretationNote).toBe('')
  })
  it.each(['history', 'result', 'comparison', 'nextAttempt'])('rejects %s injected into a bounded draft', key => {
    expect(() => parseIPv4View(JSON.stringify({ ...createIPv4View(activity()), [key]: [] }))).toThrow()
  })
  it('rejects malformed/newer/oversized views while retaining legacy arbitrary drafts', () => {
    const a = createIPv4View(activity())
    for (const raw of ['oops', JSON.stringify({ ...a, modelVersion: 'future' }), JSON.stringify({ ...a, phase: 'revealed' }),
      JSON.stringify({ ...a, input: { ...a.input, address: 'a'.repeat(129) } }),
      JSON.stringify({ ...a, prediction: { ...a.prediction, interpretationNote: 'x'.repeat(501) } })]) {
      expect(() => parseIPv4View(raw)).toThrow()
      expect(() => parseEventBatch(batch([{ ...draft(a), value: raw }]), ctx.accountId)).toThrow()
    }
    const legacy = { ...draft(a), valueFormat: undefined, value: 'not JSON' }
    expect(restoreHistory(ctx.accountId, exportHistory(ctx.accountId, [legacy, sampleAttempt()]), [])).toHaveLength(2)
    expect(() => parseEventBatch(batch([{ ...legacy, valueFormat: 'future' } as unknown as Draft]), ctx.accountId)).toThrow()
  })
})

describe('causal prediction/reveal/reset plans', () => {
  it('persists prediction before result and requires every companion before exposing calculation', () => {
    const s = sequence()
    expect(s.predicted.events.map(e => e.kind)).toEqual(['ipv4-prediction'])
    expect(s.predicted.view).not.toHaveProperty('result')
    expect(readIPv4Workflow(s.a, ctx, s.predicted.view, []).status).toBe('pending')
    expect(() => planIPv4Reveal(s.a, ctx, s.predicted.view, [], ids)).toThrow(/Persiste/)
    expect(readIPv4Workflow(s.a, ctx, s.predicted.view, s.predicted.events)).toMatchObject({ status: 'predicted', result: null })
    expect(s.revealed.events.map(e => e.kind)).toEqual(['attempt', 'ipv4-reveal', 'assistance', 'exposure'])
    for (const e of s.events) {
      const partial = s.events.filter(x => x.id !== e.id)
      expect(readIPv4Workflow(s.a, ctx, s.revealed.view, partial)).toMatchObject({ status: 'pending', result: null })
    }
    expect(readIPv4Workflow(s.a, ctx, s.revealed.view, s.events).result).toMatchObject({ lower: '192.168.20.64', upper: '192.168.20.127', addressCount: 64 })
  })
  it('captures aid and foreground time at prediction; later help cannot alter the locked attempt', () => {
    const a = activity(), view = editIPv4View(createIPv4View(a), { prediction })
    const before: LabEvent = { ...ctx, id: 'before', kind: 'assistance', activityId: a.id, activityVersion: a.version, hintCount: 1, solutionViewed: false }
    const p = planIPv4Prediction(a, ctx, view, [before], { predictionId: 'p' })
    const later = { ...before, id: 'after', hintCount: 3, solutionViewed: true }
    const r = planIPv4Reveal(a, { ...ctx, activeMs: 9000 }, p.view, [before, ...p.events, later], ids)
    expect(r.events[0]).toMatchObject({ activeMs: 1200, hintCount: 1, solutionViewed: false })
    const altered = structuredClone(r.events[0]) as Attempt; altered.solutionViewed = true
    expect(() => mergeEvents(ctx.accountId, p.events, [altered])).toThrow(/originales/)
  })
  it('preserves account/content/group/family and resets without deleting history or claiming transfer', () => {
    const s = sequence(), reset = planIPv4Reset(s.a, ctx, s.revealed.view, s.events, { resetId: 'reset' })
    const events = mergeEvents(ctx.accountId, s.events, reset.events, [draft(reset.view)])
    expect(events.filter(e => e.kind === 'attempt')).toHaveLength(1)
    expect(readIPv4Workflow(s.a, ctx, reset.view, s.events).status).toBe('pending')
    expect(readIPv4Workflow(s.a, ctx, reset.view, events).status).toBe('editing')
    const edit = editIPv4View(reset.view, { input: { value: '25' }, prediction })
    const next = planIPv4Prediction(s.a, ctx, edit, events, { predictionId: 'next' })
    expect(next.events[0]).toMatchObject({ familyId: s.a.familyId, ordinal: 2, solutionViewed: true })
    expect(next.view.input.value).toBe('25')
    expect(s.events).toHaveLength(5)
    expect(serializeIPv4View(reset.view).length).toBeLessThan(1500)
  })
  it('does not mistake a reset with missing previous causal links for a completed reset', () => {
    const s = sequence(), reset = planIPv4Reset(s.a, ctx, s.revealed.view, s.events, { resetId: 'reset' })
    expect(validateIPv4History(reset.events).missingIds).toEqual(['prediction', 'reveal'])
    expect(readIPv4Workflow(s.a, ctx, reset.view, reset.events)).toMatchObject({ status: 'pending', result: null })
  })
  it('stable supplied IDs allow retry and merge idempotence without duplicate attempts', () => {
    const s = sequence()
    expect(planIPv4Reveal(s.a, { ...ctx, activeMs: 9999 }, s.predicted.view, s.predicted.events, ids)).toEqual(s.revealed)
    expect(mergeEvents(ctx.accountId, s.events, s.events)).toHaveLength(5)
    expect(restoreHistory(ctx.accountId, exportHistory(ctx.accountId, s.events), s.events)).toHaveLength(5)
    expect(() => planIPv4Reveal(s.a, ctx, s.revealed.view, s.events, ids)).toThrow()
  })
  it('deduplicates the canonical original attempt across concurrent device reveals while retaining both reveal actions', () => {
    const s = sequence()
    const other = planIPv4Reveal(s.a, { ...ctx, deviceId: 'device-b', createdAt: '2040-01-01T01:00:00Z', activeMs: 4 },
      s.predicted.view, s.predicted.events, { revealId: 'reveal-b', assistanceId: 'help-b', exposureId: 'exposure-b' })
    expect(other.events[0]).toEqual(s.attempt)
    expect(s.attempt.id).toBe(ipv4AttemptId('prediction'))
    expect(s.attempt).toMatchObject({ deviceId: ctx.deviceId, createdAt: ctx.createdAt })
    const merged = mergeEvents(ctx.accountId, s.events, other.events)
    expect(merged.filter(e => e.kind === 'attempt')).toHaveLength(1)
    expect(merged.filter(e => e.kind === 'ipv4-reveal')).toHaveLength(2)
    expect(readIPv4Workflow(s.a, ctx, other.view, merged).status).toBe('revealed')
    const changed = { ...s.attempt, deviceId: 'device-b' }
    expect(() => mergeEvents(ctx.accountId, s.predicted.events, [changed])).toThrow(/originales/)
    expect(() => parseEventBatch(batch([{ ...s.attempt, id: 'arbitrary' }]), ctx.accountId)).toThrow()
    expect(() => parseEventBatch(batch([{ ...s.attempt, feedback: 'different' }]), ctx.accountId)).toThrow()
  })
  it('does not grade concept text and retains an omitted snapshot even when answer is null', () => {
    const s = sequence({ lower: '', upper: '', member: 'omit', interpretationNote: 'Explicación conservada.' })
    expect(s.attempt).toMatchObject({ outcome: 'omitted', answer: null, ipv4: { input: DEFAULT_INPUT, prediction: { interpretationNote: 'Explicación conservada.' } } })
    expect(parseEventBatch(batch(s.events), ctx.accountId).events).toEqual(s.events)
    const explicit = sequence({ omitted: true, interpretationNote: 'No deseo calificar estos valores.' })
    expect(explicit.attempt).toMatchObject({ outcome: 'omitted', answer: null, ipv4: { prediction: { ...prediction, omitted: true, interpretationNote: 'No deseo calificar estos valores.' } } })
  })
  it.each([
    [{ lower: '', upper: '', member: 'omit', interpretationNote: 'solo nota' }, 'omitted'],
    [{ lower: '', upper: '', member: 'yes' }, 'partial'],
    [{ upper: '', member: 'omit' }, 'partial'],
    [{ upper: '', member: 'no' }, 'incorrect'],
    [{ lower: 'wrong', upper: '', member: 'omit' }, 'incorrect'],
    [{ interpretationNote: 'Conceptualmente falsa y no puntuada.' }, 'correct'],
  ] as const)('grades numeric fields with omission distinct from error: %j => %s', (patch, outcome) => {
    expect(sequence(patch).attempt.outcome).toBe(outcome)
  })
  it('does not count an unasked membership answer as a numeric response', () => {
    const s = sequence({ lower: '', upper: '', member: 'yes' }, { ...DEFAULT_INPUT, probe: '' })
    expect(s.attempt).toMatchObject({ outcome: 'omitted', answer: null, ipv4: { comparison: { member: 'not-asked' } } })
    expect(sequence({ member: 'no' }, { ...DEFAULT_INPUT, probe: '' }).attempt.outcome).toBe('correct')
  })
  it.each([
    [{ address: '255.255.255.255', value: '0', probe: '0.0.0.0', context: 'numeric' }, '0.0.0.0', '255.255.255.255', 'numeric-only'],
    [{ address: '10.0.0.5', value: '31', probe: '10.0.0.4', context: 'p2p-compatible' }, '10.0.0.4', '10.0.0.5', 'p2p-private'],
    [{ address: '10.0.0.5', value: '32', probe: '10.0.0.5', context: 'conventional' }, '10.0.0.5', '10.0.0.5', 'host-prefix'],
  ] as const)('preserves numeric boundary and interpretation separation for %j', (input, lower, upper, interpretation) => {
    const s = sequence({ lower, upper, member: 'yes' }, { ...DEFAULT_INPUT, ...input })
    expect(s.attempt.outcome).toBe('correct')
    const reading = readIPv4Workflow(s.a, ctx, s.revealed.view, s.events)
    expect(reading.result).toMatchObject({ lower, upper, interpretation: { kind: interpretation, assignability: 'not-determined' } })
  })
})

describe('new history contracts reject corruption before storage', () => {
  it.each(['comparison', 'answer', 'outcome', 'gradingVersion', 'phase', 'modelVersion', 'input'])('rejects forged %s without changing legacy acceptance', key => {
    const s = sequence(), changed = structuredClone(s.attempt)
    if (key === 'comparison') changed.ipv4!.comparison.lower = 'incorrect'
    else if (key === 'answer') changed.answer = 'different'
    else if (key === 'outcome') changed.outcome = 'partial'
    else if (key === 'gradingVersion') changed.gradingVersion = 'future'
    else if (key === 'phase') changed.phase = 'reserved'
    else if (key === 'modelVersion') changed.ipv4!.modelVersion = 'future'
    else changed.ipv4!.input = { ...DEFAULT_INPUT, value: 'invalid' }
    expect(() => parseEventBatch(batch([changed]), ctx.accountId)).toThrow()
    expect(parseEventBatch(batch([sampleAttempt()]), ctx.accountId)).toBeDefined()
  })
  it('rejects partial on legacy attempts and a partial result containing any incorrect field', () => {
    expect(() => parseEventBatch(batch([{ ...sampleAttempt(), outcome: 'partial' }]), ctx.accountId)).toThrow()
    const s = sequence({ upper: '' }); expect(s.attempt.outcome).toBe('partial')
    const bad = structuredClone(s.attempt); bad.ipv4!.comparison.lower = 'incorrect'
    expect(() => parseEventBatch(batch([bad]), ctx.accountId)).toThrow()
  })
  it.each(['accountId', 'activityId', 'activityVersion', 'packageId', 'packageVersion', 'attemptGroupId', 'familyId'])('rejects a late causal parent crossing %s', key => {
    const s = sequence(), predictionEvent = structuredClone(s.predicted.events[0]) as IPv4PredictionEvent
    Object.assign(predictionEvent, { [key]: 'other' })
    expect(mergeEvents(ctx.accountId, s.revealed.events)).toHaveLength(4)
    expect(() => mergeEvents(ctx.accountId, s.revealed.events, [predictionEvent])).toThrow()
    expect(() => restoreHistory(ctx.accountId, JSON.stringify(batch([predictionEvent])), s.revealed.events)).toThrow()
  })
  it('rejects references to the wrong event kind, divergent view snapshots and lost assistance/exposure', () => {
    const s = sequence()
    expect(() => mergeEvents(ctx.accountId, s.revealed.events, [{ ...sampleAttempt('prediction') }])).toThrow()
    const wrongDraft = draft({ ...s.predicted.view, input: { ...DEFAULT_INPUT, value: '25' } })
    expect(() => mergeEvents(ctx.accountId, s.predicted.events, [wrongDraft])).toThrow(/distinta/)
    for (const id of ['help', 'exposure']) {
      const wrong = s.events.map(e => e.id !== id ? e : { ...e, ...(id === 'help' ? { solutionViewed: false } : { familyId: 'other' }) }) as LabEvent[]
      expect(() => mergeEvents(ctx.accountId, wrong)).toThrow()
    }
  })
  it('allows out-of-order links without exposing result and rejects late identity collision', () => {
    const s = sequence()
    let events: LabEvent[] = []
    for (const event of [...s.events].reverse()) events = mergeEvents(ctx.accountId, events, [event])
    expect(readIPv4Workflow(s.a, ctx, s.revealed.view, events).status).toBe('revealed')
    expect(() => mergeEvents(ctx.accountId, events, [{ ...s.predicted.events[0], deviceId: 'collision' }])).toThrow(/Colisión/)
  })
  it('rejects invalid linked history in record/restore/sync while preserving stored events and pending IDs', async () => {
    const s = sequence(), valid = [s.predicted.events[0]], invalid = structuredClone(s.revealed.events)
    ;(invalid[0] as Attempt).hintCount = 99
    let state: StoredHistory = { events: valid, pendingIds: ['prediction'] }
    const store: HistoryStore = { read: async () => structuredClone(state), update: async change => {
      const next = change(structuredClone(state)); state = structuredClone(next); return structuredClone(state)
    } }
    let remote: EventBatch[] = []; const uploads: EventBatch[] = []
    const transport: LabTransport = { list: async () => remote.map((_, i) => ({ id: String(i) })),
      read: async id => remote[Number(id)], append: async b => { uploads.push(b) } }
    const sync = new LabSync(ctx.accountId, store, transport); await sync.load()
    const before = structuredClone(state)
    await expect(sync.record(invalid)).rejects.toThrow(); expect(state).toEqual(before)
    expect(() => restoreHistory(ctx.accountId, JSON.stringify(batch(invalid)), valid)).toThrow(); expect(state).toEqual(before)
    remote = [batch(invalid)]
    await expect(sync.refresh()).rejects.toThrow(); expect(state).toEqual(before); expect(uploads).toEqual([])
    remote = []; await sync.record([...s.revealed.events, draft(s.revealed.view)])
    expect(state.events).toHaveLength(6); expect(state.pendingIds).toHaveLength(6)
    expect(readIPv4Workflow(s.a, ctx, s.revealed.view, state.events).status).toBe('revealed')
  })
  it('keeps a failed atomic reveal hidden and retries the same event identities once storage recovers', async () => {
    const s = sequence()
    let state: StoredHistory = { events: s.predicted.events, pendingIds: ['prediction'] }, failing = true
    const store: HistoryStore = { read: async () => structuredClone(state), update: async change => {
      const next = change(structuredClone(state))
      if (failing) throw new Error('synthetic storage failure')
      state = structuredClone(next); return structuredClone(state)
    } }
    const transport: LabTransport = { list: async () => [], read: async () => null, append: async () => {} }
    const sync = new LabSync(ctx.accountId, store, transport); await sync.load()
    const original = structuredClone(state), atomic = [...s.revealed.events, draft(s.revealed.view)]
    await expect(sync.record(atomic)).rejects.toThrow('storage failure')
    expect(state).toEqual(original)
    expect(readIPv4Workflow(s.a, ctx, s.revealed.view, state.events)).toMatchObject({ status: 'pending', result: null })
    failing = false; await sync.record(atomic); await sync.record(atomic)
    expect(state.events.filter(e => e.kind === 'attempt')).toHaveLength(1)
    expect(state.events).toHaveLength(6)
    expect(readIPv4Workflow(s.a, ctx, s.revealed.view, state.events).status).toBe('revealed')
  })
})
