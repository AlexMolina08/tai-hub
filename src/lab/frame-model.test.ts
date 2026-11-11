import { expect, it } from 'vitest'
import { describeFrame, FRAME_MODEL_VERSION, matchesFrameAnswer, parseFrameDraft, validFrameAnswer, validFrameProfile } from './frame-model'
import type { FrameProfile } from './frame-model'
import { samplePackage } from './fixtures.test-support'
import { parsePackage } from './validate'

const expected = (profile: FrameProfile, values: string[]) => describeFrame(profile, values).answers.map(a => a.expected)

it('separates equal magnitudes from coincident points and shows signed coordinates', () => {
  const profile = { kind: 'constellation' } as const
  expect(expected(profile, ['1', '3', '3', '1'])).toEqual(['Sí', 'No'])
  expect(expected(profile, ['1', '-3', '1', '-3'])).toEqual(['Sí', 'Sí'])
  expect(describeFrame(profile, ['3', '1', '-3', '3']).points).toEqual([[3, 1], [-3, 3]])
  expect(expected(profile, ['3', '1', '-3', '3'])).toEqual(['No', 'No'])
})

it('keeps the received order with changed slot owners, including a flow with no slots', () => {
  const profile: FrameProfile = { kind: 'slots', symbols: ['Q', '7', 'X', '2'], owners: ['A', 'B', 'A', 'B'] }
  const out = describeFrame(profile, ['A', 'B', 'B', 'A']).answers
  expect(out.map(a => a.expected)).toEqual(['Q2', '7X'])
  expect(matchesFrameAnswer(out[0], 'q, 2')).toBe(true)
  expect(matchesFrameAnswer(out[0], '2Q')).toBe(false)
  expect(expected(profile, ['A', 'A', 'A', 'A'])).toEqual(['Q7X2', '-'])
})

it('recovers signed coefficients only for the declared orthogonal codes', () => {
  const profile = { kind: 'correlation', chips: [0, 2] as [number, number] } as const
  expect(expected(profile, ['(+,+) y (+,−)'])).toEqual(['Sí', 'Positiva', 'Negativa'])
  expect(expected(profile, ['(+,+) y (+,+)'])).toEqual(['No', 'No separable', 'No separable'])
})

it('applies parity to the transmitted word and detects odd but not even flip counts', () => {
  const profile = { kind: 'parity', bits: '10011010' } as const
  const draft = parseFrameDraft('{}', profile)
  expect(expected(profile, draft.controls)).toEqual(['0', 'Sí'])
  const altered = [...draft.controls]
  altered[9] = '1'
  expect(expected(profile, altered)).toEqual(['0', 'No'])
  altered[1] = '1'
  expect(expected(profile, altered)).toEqual(['0', 'Sí'])
  altered[0] = 'Impar'
  expect(expected(profile, altered)).toEqual(['1', 'Sí'])
  expect(parseFrameDraft(JSON.stringify({ controls: altered, answers: ['1', 'Sí'] }), profile))
    .toEqual({ controls: altered, answers: ['1', 'Sí'] })
  expect(parseFrameDraft(JSON.stringify({ controls: ['invalid'], answers: ['1', 'Sí'] }), profile)).toEqual(draft)
})

it('verifies checksum padding and carry and FCS order and altered residue', () => {
  const checksum: FrameProfile = { kind: 'checksum', vectors: [
    { title: 'Plegado', bytes: [0, 1, 242, 3, 244, 245, 246, 247] }, { title: 'Impar', bytes: [1] },
  ] }
  expect(expected(checksum, ['Plegado', 'Sin cambio'])).toEqual(['220D'])
  expect(expected(checksum, ['Impar', 'Sin cambio'])).toEqual(['FEFF'])
  expect(expected(checksum, ['Impar', 'Invertir el bit menos significativo del primer octeto'])).toEqual(['FFFF'])
  const fcs: FrameProfile = { kind: 'fcs', vectors: [
    { title: 'Vector publicado', bytes: Array.from('123456789', s => s.charCodeAt(0)) }, { title: 'Otro', bytes: [1] },
  ] }
  const good = describeFrame(fcs, ['Vector publicado', 'Sin cambio'])
  expect(good.answers[0].expected).toBe('Sí')
  expect(good.steps.join(' ')).toContain('6E 90')
  expect(good.steps.join(' ')).toContain('F0B8')
  expect(expected(fcs, ['Vector publicado', 'Invertir el bit menos significativo del primer octeto'])).toEqual(['No'])
})

it('uses a single XOR equation for one known erasure and accepts a wrong dash as an answer', () => {
  const profile: FrameProfile = { kind: 'xor', symbols: [0x17, 0x20, 0x4b] }
  const answer = describeFrame(profile, ['Símbolo B']).answers[1]
  expect(answer.expected).toBe('20')
  expect(validFrameAnswer(answer, '-')).toBe(true)
  expect(matchesFrameAnswer(answer, '-')).toBe(false)
  expect(matchesFrameAnswer(answer, '0x20')).toBe(true)
  expect(expected(profile, ['Símbolos A y B'])).toEqual(['No', '-'])
})

it('keeps distinct forward, reverse and useful bits for lost frame versus lost ACK', () => {
  const profile: FrameProfile = { kind: 'arq', sizes: [
    { frameBits: 160, payloadBits: 120, ackBits: 24 }, { frameBits: 200, payloadBits: 120, ackBits: 40 },
  ] }
  expect(expected(profile, ['160 bits', 'Trama perdida'])).toEqual(['A, A, B', '480', '48', '240', '120/160'])
  const out = describeFrame(profile, ['160 bits', 'Trama recibida y ACK perdido']).answers
  expect(out.map(a => a.expected)).toEqual(['A, A, B', '480', '72', '240', '120/160'])
  expect(matchesFrameAnswer(out.at(-1)!, '3 / 4')).toBe(true)
  expect(matchesFrameAnswer(out.at(-1)!, '3/5')).toBe(false)
  expect(validFrameAnswer(out.at(-1)!, '1/0')).toBe(false)
})

it('validates profiles and restricts the interactive activity to practice', () => {
  for (const invalid of [
    { kind: 'parity', bits: '111100001' },
    { kind: 'slots', symbols: ['X', 'Y', 'Z', '7'], owners: ['A', 'B', 'C', 'B'] },
    { kind: 'fcs', vectors: [{ title: 'A', bytes: [256] }, { title: 'B', bytes: [] }] },
    { kind: 'correlation', chips: [0, NaN] },
    { kind: 'arq', sizes: [{ frameBits: 4, payloadBits: 5, ackBits: 1 }, { frameBits: 6, payloadBits: 4, ackBits: 1 }] },
  ]) expect(validFrameProfile(invalid)).toBe(false)
  const pack = samplePackage()
  const sample = { ...pack.activities[0], kind: 'frame-model', phase: 'practice', profile: { kind: 'constellation' },
    mode: { ...pack.activities[0].mode, kind: 'simulation', version: FRAME_MODEL_VERSION } }
  const withActivity = (activity: unknown) => ({ ...pack, activities: [activity, ...pack.activities.slice(1)] })
  expect(() => parsePackage(withActivity(sample), 'study')).not.toThrow()
  expect(() => parsePackage(withActivity({ ...sample, phase: 'reserved' }), 'authoring')).toThrow('perfil de símbolos y tramas')
})
