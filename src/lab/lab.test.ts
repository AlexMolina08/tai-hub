import { describe, expect, it } from 'vitest'
import { sampleAttempt, samplePackage } from './fixtures.test-support'
import { parseEventBatch, parsePackage } from './validate'
import { draftHeads, draftKey, exportHistory, mergeEvents, restoreHistory } from './history'
import { LabSync, type LabTransport } from './sync'
import type { Draft, EventBatch, LabEvent } from './model'
import type { HistoryStore, StoredHistory } from './store'
import { compareSqlRows } from './sql-comparison'
import { assistanceFor } from './grading'
import { ActiveTime } from './active-time'
import { familyConflicts } from './partitions'

it('counts foreground time once per attempt and excludes hidden intervals', () => {
  const clock = new ActiveTime(100, true)
  clock.visibility(200, false)
  clock.visibility(10_000, true)
  expect(clock.take(10_100, true)).toBe(200)
  expect(clock.take(10_150, true)).toBe(50)
  clock.visibility(10_200, false)
  expect(clock.take(90_000, false)).toBe(50)
})

describe('content contracts and publication gates', () => {
  it('accepts documentary choices but rejects an executable activity with that declaration', () => {
    const pack = samplePackage()
    pack.activities[0].mode.kind = 'documentary'
    expect(parsePackage(pack).activities[0].mode.kind).toBe('documentary')
    pack.activities[0] = { ...pack.activities[0], kind: 'code', language: 'javascript', starter: 'console.log(input)',
      datasets: [{ id: 'a', input: 1, expectedOutput: ['1'] }, { id: 'b', input: 2, expectedOutput: ['2'] }] }
    expect(() => parsePackage(pack)).toThrow('un caso documental requiere respuesta preparada, sin ejecutor')
  })
  it('requires bounded, distinct prepared code cases and a supported language', () => {
    const pack = samplePackage()
    pack.activities[0] = { ...pack.activities[0], kind: 'code', language: 'python', starter: 'print(sum(input))',
      datasets: [{ id: 'a', input: [2, -1], expectedOutput: ['1'] }, { id: 'b', input: [], expectedOutput: ['0'] }] }
    expect(parsePackage(pack)).toEqual(pack)
    pack.activities[0].datasets[1].id = 'a'
    expect(() => parsePackage(pack)).toThrow('casos de código inválidos')
    pack.activities[0].datasets[1].id = 'b'
    pack.activities[0].datasets[0].expectedOutput = Array(101).fill('x')
    expect(() => parsePackage(pack)).toThrow('casos de código inválidos')
  })

  it('accepts a complete synthetic package and returns a detached value', () => {
    const pack = samplePackage()
    expect(parsePackage(pack)).toEqual(pack)
    expect(parsePackage(pack)).not.toBe(pack)
  })
  it('keeps planned destinations without pretending their content exists', () => {
    const pack = samplePackage()
    pack.objectives[0].state = 'planned'
    pack.lessons = []; pack.activities = []; pack.evidence = []
    expect(parsePackage(pack, 'authoring').objectives[0].state).toBe('planned')
    expect(() => parsePackage(pack)).toThrow(/no validado|sin contenido/)
  })
  it.each(['sources', 'objectives', 'lessons', 'activities', 'evidence'] as const)('rejects malformed %s instead of throwing a TypeError', key => {
    expect(() => parsePackage({ ...samplePackage(), [key]: [null] })).toThrow(/lista inválida/)
  })
  it('rejects missing L/P/E, detached sources and incomplete distractors', () => {
    const pack = samplePackage()
    pack.objectives[0].reservedIds = []
    expect(() => parsePackage(pack)).toThrow(/L\/P\/E/)
    pack.objectives[0].reservedIds = ['r1']
    pack.activities[0].claims[0].sourceId = 'absent'
    expect(() => parsePackage(pack)).toThrow(/referencia inexistente/)
    pack.activities[0].claims[0].sourceId = 's1'
    if (pack.activities[0].kind === 'choice') pack.activities[0].options[1].explanation = ''
    expect(() => parsePackage(pack)).toThrow(/opciones inválidas/)
  })
  it('rejects family and scenario leakage into reserved or delayed assessment', () => {
    for (const key of ['familyId', 'scenarioId'] as const) {
      const pack = samplePackage()
      pack.activities[5][key] = pack.activities[0][key]
      expect(() => parsePackage(pack)).toThrow(/cruce entre entrenamiento y reserva/)
    }
  })
  it('requires fresh evidence after an activity version changes', () => {
    const pack = samplePackage(); pack.activities[0].version = '2'
    expect(() => parsePackage(pack)).toThrow(/sin superar para esta versión/)
  })
  it('allows declared delayed retention to revisit training, but never a reserved family', () => {
    const pack = samplePackage()
    const delayed = pack.activities.find(a => a.phase === 'delayed')!
    delayed.evaluationIntent = 'retention'; delayed.familyId = pack.activities[0].familyId
    expect(parsePackage(pack).activities.find(a => a.phase === 'delayed')?.evaluationIntent).toBe('retention')
    delayed.familyId = pack.activities.find(a => a.phase === 'reserved')!.familyId
    expect(() => parsePackage(pack)).toThrow(/cruce entre entrenamiento y reserva/)
    pack.activities[0].evaluationIntent = 'transfer'
    expect(() => parsePackage(pack)).toThrow(/intención de evaluación inválida/)
  })
  it('detects a reserved family leaking through another package or content version', () => {
    const first = samplePackage(), second = samplePackage()
    second.id = 'other-package'
    second.activities[0].familyId = 'other-training'
    second.activities.find(a => a.phase === 'reserved')!.familyId = first.activities[0].familyId
    expect(() => parsePackage(second)).not.toThrow()
    expect(familyConflicts([...first.activities, ...second.activities])).toEqual(['family:f-p1: cruce entre entrenamiento y reserva'])
  })
  it('does not hide failed gates behind an older pass', () => {
    const pack = samplePackage(); pack.evidence.push({ ...pack.evidence[0], id: 'failed', result: 'fail' })
    expect(() => parsePackage(pack)).toThrow(/sin superar/)
  })
  it.each(['annulled', 'disputed', 'unreconciled'] as const)('excludes %s items from study', status => {
    const pack = samplePackage(); pack.activities[0].provenance.status = status
    expect(() => parsePackage(pack)).toThrow(/procedencia/)
  })
})

describe('immutable history and concurrent drafts', () => {
  it('does not erase assistance after retry, navigation or synchronization', () => {
    const a = sampleAttempt()
    const helped = { ...a, id: 'helped', hintCount: 2, solutionViewed: true }
    expect(assistanceFor(mergeEvents('account-a', [helped], [a]), a.attemptGroupId)).toEqual({ hintCount: 2, solutionViewed: true })
  })
  it('preserves two offline attempts, replays idempotently and ignores wall-clock order', () => {
    const a = sampleAttempt(); const b = { ...sampleAttempt('a2', 'device-b'), createdAt: '2000-01-01T00:00:00Z' }
    expect(mergeEvents('account-a', [a], [b], [a])).toEqual(mergeEvents('account-a', [b], [a]))
    expect(mergeEvents('account-a', [a, b])).toHaveLength(2)
    expect(() => mergeEvents('account-a', [a], [{ ...a, outcome: 'incorrect' }])).toThrow(/Colisión/)
  })
  it('rejects a different account and preserves correction/content versions through export', () => {
    const a = sampleAttempt()
    const raw = exportHistory('account-a', [a])
    expect(restoreHistory('account-a', raw, [a])).toEqual([a])
    expect(() => restoreHistory('account-b', raw, [])).toThrow(/otra cuenta/)
    expect(() => parseEventBatch({ ...JSON.parse(raw), schema: 2 }, 'account-a')).toThrow(/incompatible/)
  })
  it('preserves divergent drafts until an explicit merge names both parents', () => {
    const base: Draft = { id: 'd0', kind: 'draft', deviceId: 'device-a', accountId: 'account-a', createdAt: '2026-11-11T10:00:00Z',
      activityId: 'p1', activityVersion: '1', packageId: 'synthetic', packageVersion: '1', attemptGroupId: 'g1', parentIds: [], value: 'initial', position: 0 }
    const left = { ...base, id: 'd1', parentIds: ['d0'], value: 'left' }
    const right = { ...base, id: 'd2', deviceId: 'device-b', parentIds: ['d0'], value: 'right' }
    const events = [base, left, right]
    expect(draftHeads(events, draftKey(base)).map(d => d.value)).toEqual(['left', 'right'])
    const resolved = { ...base, id: 'd3', parentIds: ['d1', 'd2'], value: 'chosen' }
    expect(draftHeads([...events, resolved], draftKey(base))).toEqual([resolved])
    expect(() => draftHeads([{ ...base, parentIds: ['d1'] }, left], draftKey(base))).toThrow(/Ciclo/)
  })
})

describe('SQL requirement comparison', () => {
  it('preserves duplicate multiplicity and NULL while ignoring order for bags', () => {
    expect(compareSqlRows([[null], [2], [2]], [[2], [null], [2]], 'bag')).toBe(true)
    expect(compareSqlRows([[null], [2]], [[2], [null], [2]], 'bag')).toBe(false)
    expect(compareSqlRows([[null], [2]], [[2], [null], [2]], 'set')).toBe(true)
    expect(compareSqlRows([[null], [2]], [[2], [null]], 'ordered')).toBe(false)
    expect(compareSqlRows([], [], 'bag')).toBe(true)
    expect(compareSqlRows([[null]], [], 'bag')).toBe(false)
  })
})

function memoryStore(): HistoryStore {
  let state: StoredHistory = { events: [], pendingIds: [] }
  return { read: async () => structuredClone(state), update: async change => {
    state = change(structuredClone(state)); return structuredClone(state)
  } }
}
describe('local-first synchronization', () => {
  function setup() {
    const files: EventBatch[] = []
    let offline = false
    let loseAck = false
    const transport: LabTransport = {
      list: async () => { if (offline) throw new Error('offline'); return files.map((_, i) => ({ id: String(i) })) },
      read: async id => files[Number(id)],
      append: async batch => { files.push(structuredClone(batch)); if (loseAck) { loseAck = false; throw new Error('ack lost') } },
    }
    const a = new LabSync('account-a', memoryStore(), transport)
    const b = new LabSync('account-a', memoryStore(), transport)
    return { files, transport, a, b, offline: (v: boolean) => { offline = v }, loseAck: () => { loseAck = true } }
  }
  it('merges offline devices and duplicate uploads after a lost acknowledgement', async () => {
    const s = setup(); s.offline(true)
    await s.a.record([sampleAttempt()]); await s.b.record([sampleAttempt('a2', 'device-b')])
    await expect(s.a.refresh()).rejects.toThrow('offline')
    expect(s.a.snapshot().pendingIds).toEqual(['a1'])
    s.offline(false); s.loseAck()
    await expect(s.a.refresh()).rejects.toThrow('ack lost')
    await s.a.refresh(); await s.b.refresh(); await s.a.refresh()
    expect(s.a.snapshot().events).toHaveLength(2)
    expect(s.a.snapshot().events).toEqual(s.b.snapshot().events)
    expect(s.a.snapshot().status).toBe('synced')
  })
  it('does not acknowledge an edit created while upload is in flight', async () => {
    const s = setup()
    const append = s.transport.append
    s.transport.append = async batch => { await s.a.record([sampleAttempt('a2')]); await append(batch) }
    await s.a.record([sampleAttempt()]); await s.a.refresh()
    expect(s.a.snapshot().pendingIds).toEqual(['a2'])
  })
  it('retains local work when a corrupt or cross-account replica is encountered', async () => {
    const s = setup(); await s.a.record([sampleAttempt()])
    s.files.push({ schema: 1, privacy: 'tai-lab-private', accountId: 'wrong', events: [] })
    await expect(s.a.refresh()).rejects.toThrow(/otra cuenta/)
    expect(s.a.snapshot().events).toHaveLength(1)
    expect(s.a.snapshot().pendingIds).toEqual(['a1'])
  })
  it('reports quota failure without claiming that unsaved work was stored', async () => {
    const s = setup()
    const failing: HistoryStore = { read: async () => ({ events: [], pendingIds: [] }), update: async () => { throw new Error('quota') } }
    const sync = new LabSync('account-a', failing, s.transport)
    await expect(sync.record([sampleAttempt()])).rejects.toThrow('quota')
    expect(sync.snapshot().status).toBe('error')
    expect(sync.snapshot().events).toHaveLength(0)
  })
})
