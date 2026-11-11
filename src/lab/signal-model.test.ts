import { expect, it } from 'vitest'
import { describeSignalCase, parseSignalAnswers, SIGNAL_MODEL_VERSION, signalAnswerMatches, signalAnswersComplete, validSignalCases } from './signal-model'
import type { SignalCase } from './signal-model'
import { samplePackage } from './fixtures.test-support'
import { parsePackage } from './validate'

const base = { id: 'a', title: 'Caso A' }
const limit = { ...base, kind: 'limits', bandwidthHz: 3000, levels: 4, snrDb: 20 } as const

it('applies distinct assumptions to Nyquist and Shannon and converts dB before taking the logarithm', () => {
  const { fields } = describeSignalCase(limit)
  expect(fields.map(f => f.expected)).toEqual(['12', '19.97'])
  expect(signalAnswerMatches(fields[1], '19,97')).toBe(true)
  expect(signalAnswerMatches(fields[1], '13.18')).toBe(false)
  expect(signalAnswerMatches(fields[1], '19.970')).toBe(false)
  expect(describeSignalCase({ ...limit, snrDb: 0 }).fields.map(f => f.expected)).toEqual(['12', '3'])
})

it('computes units, limits, zero payload and the queue contribution before rounding', () => {
  const output = (item: SignalCase) => describeSignalCase(item).fields.map(f => f.expected)
  expect(output({ ...base, kind: 'rate', symbolsPerSecond: 2400, levels: 8, payloadBytes: 5, frameBytes: 6 }))
    .toEqual(['3', '7.2', '6'])
  expect(output({ ...base, kind: 'rate', symbolsPerSecond: 2400, levels: 8, payloadBytes: 0, frameBytes: 6 }))
    .toEqual(['3', '7.2', '0'])
  expect(output({ ...base, kind: 'latency', frameBytes: 1500, rateKbps: 2000, distanceKm: 60, speedKmPerSecond: 200000, queueMs: 2.3 }))
    .toEqual(['6', '0.3', '8.6'])
  expect(output({ ...base, kind: 'power', inputMw: 10, outputMw: 1, noiseMw: 10 }))
    .toEqual(['10', '-10'])
  const tied = describeSignalCase({ ...base, kind: 'latency', frameBytes: 1, rateKbps: 8,
    distanceKm: 0, speedKmPerSecond: 200000, queueMs: 0.005 }).fields[2]
  expect(tied.expected).toBe('1.01')
  expect(signalAnswerMatches(tied, '1.00')).toBe(true)
  expect(signalAnswerMatches(tied, '1.01')).toBe(true)
  expect(signalAnswerMatches(tied, '1.02')).toBe(false)
})

it('classifies transmission axes independently and preserves both answers in the draft', () => {
  const original = { ...base, kind: 'transmission', signal: 'discrete', lanes: 4, timing: 'frame', direction: 'alternate', nodes: 2 } as const
  const modified = { ...original, id: 'b', title: 'Caso B', direction: 'simultaneous', nodes: 3 } as const
  const cases = [original, modified]
  const answers = cases.map(c => describeSignalCase(c).fields.map(f => f.expected))
  expect(answers).toEqual([
    ['Digital', 'Paralelo', 'Asíncrona', 'Half dúplex', 'Punto a punto'],
    ['Digital', 'Paralelo', 'Asíncrona', 'Full dúplex', 'Multipunto'],
  ])
  expect(parseSignalAnswers(JSON.stringify(answers), cases)).toEqual(answers)
  expect(signalAnswersComplete(cases, answers)).toBe(true)
  expect(signalAnswersComplete(cases, parseSignalAnswers('invalid', cases))).toBe(false)
  expect(validSignalCases([original, { ...original, id: 'b' }])).toBe(false)
})

it('admits a bounded simulation in the private package contract and rejects unsafe or ambiguous inputs', () => {
  const pack = samplePackage()
  const activity = { ...pack.activities[0], kind: 'signal-model', phase: 'practice',
    mode: { ...pack.activities[0].mode, kind: 'simulation', version: SIGNAL_MODEL_VERSION },
    cases: [limit, { ...limit, id: 'b', title: 'Caso B', snrDb: 0 }] }
  const packageWith = (replacement: unknown) => ({ ...pack, activities: [replacement, ...pack.activities.slice(1)] })
  expect(() => parsePackage(packageWith(activity), 'study')).not.toThrow()
  for (const invalid of [
    { ...activity, cases: [limit, { ...limit, id: 'b', levels: 3 }] },
    { ...activity, cases: [limit, { ...limit, id: 'b', bandwidthHz: Infinity }] },
    { ...activity, cases: [limit, { ...limit, id: 'b', snrDb: -31 }] },
    { ...activity, mode: { ...activity.mode, version: 'future-model' } },
    { ...activity, phase: 'reserved' },
  ]) expect(() => parsePackage(packageWith(invalid), 'authoring')).toThrow('modelo de señales')
})
