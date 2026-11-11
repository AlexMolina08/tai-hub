import { expect, it } from 'vitest'
import { calculate, createState, DEFAULT_INPUT, editInput, MODEL_VERSION, reset, reveal, submitPrediction, validateInput } from './ipv4'
import type { IPv4Input } from './ipv4'

// Synthetic engineering cases; no private activity IDs, exam questions or editorial answer corpus.
const input = (patch: Partial<IPv4Input> = {}): IPv4Input => ({ ...DEFAULT_INPUT, ...patch })
const result = (patch: Partial<IPv4Input> = {}) => {
  const value = calculate(input(patch))
  if (!value.ok) throw new Error(value.error.message)
  return value
}

it('computes inclusive bounds without confusing membership with conventional host assignment', () => {
  const value = result()
  expect(value).toMatchObject({ modelVersion: MODEL_VERSION, prefix: 26, mask: '255.255.255.192',
    lower: '192.168.20.64', upper: '192.168.20.127', addressCount: 64, hostBits: 6, probeMember: true, probePosition: 'upper' })
  expect(value.interpretation).toMatchObject({ kind: 'conventional-private', directedBroadcast: '192.168.20.127',
    conventionalInterior: { lower: '192.168.20.65', upper: '192.168.20.126', count: 62 }, assignability: 'not-determined' })
  expect(result({ probe: '192.168.20.64' }).probePosition).toBe('lower')
  expect(result({ probe: '192.168.20.128' }).probeMember).toBe(false)
})

it('uses the full prefix across octets and accepts an equivalent contiguous mask', () => {
  const patch = { address: '172.28.7.254', value: '23', probe: '172.28.7.1' }
  const prefix = result(patch), mask = result({ ...patch, format: 'mask', value: '255.255.254.0' })
  expect(prefix).toEqual(mask)
  expect(prefix).toMatchObject({ lower: '172.28.6.0', upper: '172.28.7.255', addressCount: 512, probeMember: true, probePosition: 'interior' })
  expect(result({ address: '10.50.2.165', value: '27', probe: '10.50.2.192' })).toMatchObject({
    lower: '10.50.2.160', upper: '10.50.2.191', mask: '255.255.255.224', addressCount: 32, probeMember: false })
})

it('keeps /0 and the unsigned IPv4 maximum exact without enumerating the block', () => {
  const value = result({ address: '198.51.100.9', value: '0', probe: '255.255.255.255' })
  expect(value).toMatchObject({ lower: '0.0.0.0', upper: '255.255.255.255', mask: '0.0.0.0', addressCount: 4294967296, probeMember: true })
  expect(value.interpretation).toMatchObject({ kind: 'numeric-only', directedBroadcast: null, conventionalInterior: null })
  expect(result({ format: 'mask', value: '0.0.0.0' }).prefix).toBe(0)
  expect(result({ format: 'mask', value: '255.255.255.255' }).prefix).toBe(32)
})

it('interprets /31 only under the explicitly compatible context and the model scope', () => {
  const patch = { address: '192.168.2.91', value: '31', probe: '192.168.2.90' }
  expect(result({ ...patch, context: 'p2p-compatible' }).interpretation).toMatchObject({ kind: 'p2p-private',
    pointToPointEndpoints: ['192.168.2.90', '192.168.2.91'], directedBroadcast: null, conventionalInterior: null, assignability: 'not-determined' })
  const conventional = result(patch)
  expect(conventional.addressCount).toBe(2)
  expect(conventional.interpretation).toMatchObject({ kind: 'needs-p2p-context', pointToPointEndpoints: null, conventionalInterior: null })
  expect(result({ ...patch, context: 'numeric' }).interpretation.kind).toBe('numeric-only')
  expect(result({ ...patch, value: '30', context: 'p2p-compatible' }).interpretation.kind).toBe('context-mismatch')
  expect(result({ ...patch, address: '203.0.113.91', context: 'p2p-compatible' }).interpretation).toMatchObject({
    kind: 'numeric-only', pointToPointEndpoints: null })
})

it('treats /32 as exact matching without claiming an assignable or reachable host', () => {
  const patch = { address: '203.0.113.77', value: '32', probe: '203.0.113.77' }
  expect(result(patch)).toMatchObject({ lower: '203.0.113.77', upper: '203.0.113.77', addressCount: 1, hostBits: 0,
    probeMember: true, probePosition: 'single', interpretation: { kind: 'host-prefix', directedBroadcast: null, assignability: 'not-determined' } })
  expect(result({ ...patch, probe: '203.0.113.78' }).probeMember).toBe(false)
  expect(result({ ...patch, address: '255.255.255.255', probe: '' }).interpretation.directedBroadcast).toBeNull()
})

it('withholds operational labels when an entire block is not contained in RFC1918', () => {
  for (const patch of [{ address: '127.3.4.5', value: '8' }, { address: '239.1.2.3', value: '16' },
    { address: '10.50.3.4', value: '7' }, { address: '172.32.0.1', value: '16' }, { address: '192.169.1.1', value: '24' }]) {
    expect(result(patch)).toMatchObject({ privateBlock: false,
      interpretation: { kind: 'numeric-only', directedBroadcast: null, conventionalInterior: null, assignability: 'not-determined' } })
  }
  expect(result({ address: '172.30.5.2', value: '12' }).privateBlock).toBe(true)
  expect(result({ address: '192.168.1.2', value: '16' }).privateBlock).toBe(true)
  expect(result({ context: 'numeric' }).interpretation.directedBroadcast).toBeNull()
})

it('trims all five text fields and represents an absent probe explicitly', () => {
  const base = input(), spaced = Object.fromEntries(Object.entries(base).map(([key, value]) => [key, ` ${value} `]))
  expect(calculate(spaced)).toEqual(calculate(base))
  expect(result({ probe: '  ' })).toMatchObject({ probe: null, probeMember: null, probePosition: null })
})

it.each([
  [{ address: '192.168.4' }, 'IP_FORMAT', 'address'],
  [{ address: '192.168.999.1' }, 'IP_RANGE', 'address'],
  [{ address: '172.016.1.1' }, 'IP_FORMAT', 'address'],
  [{ address: '192.168.4.1/26' }, 'IP_FORMAT', 'address'],
  [{ address: '1.2.3.4.5' }, 'IP_FORMAT', 'address'],
  [{ address: '1'.repeat(10000) }, 'IP_FORMAT', 'address'],
  [{ value: '34' }, 'PREFIX_RANGE', 'value'],
  [{ value: '-2' }, 'PREFIX_FORMAT', 'value'],
  [{ value: '25.5' }, 'PREFIX_FORMAT', 'value'],
  [{ value: '024' }, 'PREFIX_FORMAT', 'value'],
  [{ format: 'mask', value: '255.255.254.128' }, 'MASK_NONCONTIGUOUS', 'value'],
  [{ format: 'mask', value: '0.0.3.255' }, 'MASK_NONCONTIGUOUS', 'value'],
  [{ probe: '192.168.500.2' }, 'IP_RANGE', 'probe'],
  [{ format: 'other' }, 'FORMAT', 'format'],
  [{ context: 'other' }, 'CONTEXT', 'context'],
] as const)('rejects malformed input %j with a specific error', (patch, code, field) => {
  expect(calculate(input(patch))).toMatchObject({ ok: false, error: { code, field } })
})

it('rejects non-object inputs and non-text addresses without throwing', () => {
  for (const value of [null, [], true, '192.168.4.1']) expect(validateInput(value)).toMatchObject({ ok: false, error: { code: 'INPUT_SHAPE' } })
  expect(validateInput({ ...input(), address: 123 })).toMatchObject({ ok: false, error: { code: 'IP_TYPE', field: 'address' } })
  expect(validateInput({ ...input(), probe: null })).toMatchObject({ ok: false, error: { code: 'IP_TYPE', field: 'probe' } })
})

it('requires a prediction or voluntary omission before revealing, without a correctness gate', () => {
  const initial = createState()
  expect(reveal(initial)).toMatchObject({ result: null, error: { code: 'PREDICTION_REQUIRED' } })
  const predicted = submitPrediction(initial, { lower: 'respuesta errónea' })
  expect(predicted).toMatchObject({ phase: 'predicted', result: null })
  expect(reveal(predicted)).toMatchObject({ phase: 'revealed', comparison: { lower: 'incorrect', upper: 'omitted' } })
  const omitted = reveal(submitPrediction(createState(), { omitted: true }))
  expect(omitted).toMatchObject({ phase: 'revealed', comparison: { lower: 'omitted', upper: 'omitted', member: 'omitted' } })
})

it('invalidates the current view on edit while preserving the original prediction and input', () => {
  const predicted = submitPrediction(createState(), { lower: '192.168.20.64', upper: '192.168.20.127', member: 'yes' })
  const revealed = reveal(predicted), frozen = structuredClone(revealed)
  expect(revealed.comparison).toEqual({ lower: 'correct', upper: 'correct', member: 'correct' })
  const edited = editInput(revealed, { value: '25' })
  expect(revealed).toEqual(frozen)
  expect(edited).toMatchObject({ phase: 'editing', prediction: null, inputSnapshot: null, result: null, comparison: null })
  expect(edited.history).toEqual(frozen.history)
  expect(edited.history[0]).toMatchObject({ type: 'prediction', input: { value: '26' } })
  expect(reveal(edited).error?.code).toBe('PREDICTION_REQUIRED')
})

it('restores declared initial controls on reset and appends a reset without erasing history', () => {
  const initial = input({ address: '10.42.9.17', value: '28', probe: '' })
  const previous = reveal(submitPrediction(createState(initial), { omitted: true }))
  const cleared = reset(editInput(previous, { value: '33' }))
  expect(cleared).toMatchObject({ phase: 'editing', draft: initial, prediction: null, result: null, error: null, nextAttempt: previous.nextAttempt })
  expect(cleared.history.slice(0, -1)).toEqual(previous.history)
  expect(cleared.history.at(-1)).toEqual({ type: 'reset', afterAttempt: 1, initialInput: initial })
})

it('keeps reveal idempotent and blocks replacing an already registered prediction', () => {
  const predicted = submitPrediction(createState(), { omitted: true }), completed = reveal(predicted)
  expect(reveal(completed)).toBe(completed)
  expect(completed.history).toHaveLength(2)
  expect(submitPrediction(predicted, { lower: 'replacement' })).toMatchObject({ prediction: predicted.prediction, error: { code: 'EDIT_FIRST' } })
})

it('keeps invalid inputs and malformed predictions out of the history', () => {
  const invalid = submitPrediction(editInput(createState(), { value: '34' }), { omitted: true })
  expect(invalid).toMatchObject({ phase: 'editing', history: [], result: null, error: { code: 'PREFIX_RANGE' } })
  for (const prediction of [null, [], {}, { member: 'maybe' }, { lower: 'x'.repeat(65) }, { interpretationNote: 'x'.repeat(501) }]) {
    expect(submitPrediction(createState(), prediction)).toMatchObject({ phase: 'editing', history: [], error: { code: 'PREDICTION_FORMAT' } })
  }
})

it('retains a conceptual note without assigning it a numeric grade', () => {
  const state = reveal(submitPrediction(createState(input({ probe: '' })), { interpretationNote: 'Mi razonamiento provisional.' }))
  expect(state.prediction?.interpretationNote).toBe('Mi razonamiento provisional.')
  expect(state.comparison).toEqual({ lower: 'omitted', upper: 'omitted', member: 'not-asked' })
  expect(state.history[0]).toMatchObject({ type: 'prediction', prediction: { interpretationNote: 'Mi razonamiento provisional.' } })
})

it('copies caller-owned input and prediction values and leaves calculations unchanged by later edits', () => {
  const raw = { ...DEFAULT_INPUT }, initial = createState(raw), prediction = { lower: '192.168.20.64' }
  raw.address = '198.51.100.22'
  expect(initial.draft.address).toBe(DEFAULT_INPUT.address)
  const predicted = submitPrediction(initial, prediction)
  prediction.lower = 'changed'
  expect(predicted.history[0]).toMatchObject({ prediction: { lower: '192.168.20.64' } })
  const rawBefore = structuredClone(raw)
  calculate(raw)
  expect(raw).toEqual(rawBefore)
})
