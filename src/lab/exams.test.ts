import { describe, expect, it } from 'vitest'
import { examAnswers, examHeads, examRunReady, scoreExamSection } from './exams'
import { sampleExamPackage } from './fixtures.test-support'
import { exportHistory, mergeEvents, restoreHistory } from './history'
import type { ExamRevision } from './model'
import { parsePackage } from './validate'

const root: ExamRevision = {
  kind: 'exam-revision', id: 'run', runId: 'run', deviceId: 'mac', accountId: 'account',
  packageId: 'synthetic', packageVersion: '1', examId: 'exam-fixture', examVersion: '1',
  createdAt: '2026-11-11T10:00:00Z', startedAt: '2026-11-11T10:00:00Z', deadlineAt: '2026-11-11T10:02:00Z',
  parentIds: [], answers: [], submitted: null,
}
const a: ExamRevision = { ...root, id: 'a', parentIds: [root.id], createdAt: '2026-11-11T10:00:12Z', answers: [['q1', 'a']] }
const b: ExamRevision = { ...a, id: 'b', deviceId: 'phone', answers: [['q1', 'b']] }
const submitted: ExamRevision = { ...a, id: 'submitted', parentIds: [a.id], submitted: 'manual' }

describe('exam forms', () => {
  it('requires the proper size and all gates for the exact version', () => {
    expect(parsePackage(sampleExamPackage()).exams).toHaveLength(1)
    const pack = sampleExamPackage()
    pack.exams![0].version = '2'
    expect(() => parsePackage(pack)).toThrow(/puerta accuracy/)
    pack.exams![0].sections[0].reserves.pop()
    expect(() => parsePackage(pack, 'authoring')).toThrow(/parte de examen incompleta/)
  })
  it('blocks family, scenario and original overlap with training', () => {
    for (const key of ['familyId', 'scenarioId', 'originalId'] as const) {
      const pack = sampleExamPackage()
      const question = pack.exams![0].sections[0].questions[0]
      const activity = pack.activities[0]
      if (key === 'originalId') {
        question.provenance = { kind: 'original', originalId: 'fixture-original', status: 'eligible' }
        activity.provenance = { ...question.provenance, kind: 'adapted' }
      } else question[key] = activity[key]
      expect(() => parsePackage(pack, 'authoring')).toThrow(/cruce entre entrenamiento y reserva/)
    }
  })
  it('substitutes the first eligible reserve of that part and computes exact thirds', () => {
    const section = sampleExamPackage().exams![0].sections[0]
    const score = scoreExamSection(section, new Map([['q1', 'a'], ['q2', 'b'], ['q3', 'a'], ['r1', 'a'], ['r2', 'a'], ['r3', 'b']]))
    expect(score).toMatchObject({ correct: 2, incorrect: 1, blank: 17, maximum: 20, thirds: 5 })
    expect(score.rows.filter(row => row.reserve).map(row => row.mark)).toEqual(['annulled', 'correct', 'unused', 'unused', 'unused'])
  })
  it('checks restored answer IDs and timing against the exact form', () => {
    const form = sampleExamPackage().exams![0]
    expect(examAnswers(form, a).get('q1')).toBe('a')
    expect(() => examAnswers(form, { ...a, answers: [['q1', 'foreign']] })).toThrow(/opción ajena/)
    expect(() => examAnswers(form, { ...a, deadlineAt: a.startedAt })).toThrow(/tiempo guardado/)
  })
})

describe('exam history', () => {
  it('recovers out-of-order branches and preserves both until explicit resolution', () => {
    expect(examRunReady([b], 'run')).toBe(false)
    const merged = mergeEvents('account', [b], [root, a, b]) as ExamRevision[]
    expect(examRunReady(merged, 'run')).toBe(true)
    expect(examHeads(merged)).toEqual([a, b])
    const resolved = { ...a, id: 'resolution', parentIds: [a.id, b.id] }
    const restored = restoreHistory('account', exportHistory('account', [resolved, b, a, root]), merged) as ExamRevision[]
    expect(examHeads(restored)).toEqual([resolved])
    expect(restored).toHaveLength(4)
  })
  it('keeps a submitted score immutable and only resolves a terminal conflict to a submitted snapshot', () => {
    expect(() => mergeEvents('account', [root, a, submitted, { ...a, id: 'edit', parentIds: [submitted.id] }])).toThrow(/inmutable/)
    const resolution = { ...submitted, id: 'resolution', parentIds: [b.id, submitted.id], createdAt: root.deadlineAt }
    expect(examHeads(mergeEvents('account', [root, b, a, submitted, resolution]) as ExamRevision[])).toEqual([resolution])
    expect(() => mergeEvents('account', [root, b, a, submitted, { ...resolution, answers: b.answers }])).toThrow(/inmutable/)
    expect(() => mergeEvents('account', [root, b, a, { ...resolution, parentIds: [a.id, b.id] }])).toThrow(/Resuelve/)
  })
  it('rejects a late edit, foreign parent and cycle, including a late-arriving parent', () => {
    expect(() => mergeEvents('account', [root, { ...a, createdAt: root.deadlineAt }])).toThrow(/revisión de examen inválida/)
    expect(() => mergeEvents('account', [a], [{ ...root, examVersion: 'different' }])).toThrow(/fecha incompatible/)
    expect(() => mergeEvents('account', [{ ...a, parentIds: [b.id] }, { ...b, parentIds: [a.id] }])).toThrow(/Ciclo/)
  })
})
