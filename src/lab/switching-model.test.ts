import { expect, it } from 'vitest'
import { matchesPredictionAnswer, parsePredictionDraft } from './prediction'
import { describeSwitching, switchingControls, validSwitchingProfile, type SwitchingProfile } from './switching-model'

const timing: Extract<SwitchingProfile, { kind: 'timing' }> = { kind: 'timing', cases: [
  { label: 'Salida lenta', payloadBits: 3600, packets: 2, headerBits: 0, links: [
    { bitsPerMs: 600, propagationMs: 0 }, { bitsPerMs: 300, propagationMs: 2 },
  ] },
  { label: 'Cabecera larga', payloadBits: 4000, packets: 4, headerBits: 1000, links: [
    { bitsPerMs: 1000, propagationMs: 1 }, { bitsPerMs: 500, propagationMs: 3 }, { bitsPerMs: 1000, propagationMs: 2 },
  ] },
] }

const answers = (profile: SwitchingProfile, ...controls: string[]) =>
  describeSwitching(profile, controls).answers.map(answer => answer.expected)

it('separates serialization, propagation, bottleneck queues and header overhead', () => {
  expect(answers(timing, 'Salida lenta', 'Mensaje completo')).toEqual(['3600', '20', '20'])
  expect(answers(timing, 'Salida lenta', 'Paquetes')).toEqual(['3600', '11', '17'])
  expect(answers(timing, 'Cabecera larga', 'Mensaje completo')).toEqual(['4000', '22', '22'])
  expect(answers(timing, 'Cabecera larga', 'Paquetes')).toEqual(['8000', '14', '26'])
  expect(describeSwitching(timing, ['Salida lenta', 'Paquetes']).trace?.at(-1))
    .toBe('Enlace 2, unidad 2. Serialización de 9 a 15 ms. Último bit en destino de este enlace a 17 ms.')
})

it('admits exact fits and leaves reservations intact after a rejection', () => {
  const profile: SwitchingProfile = { kind: 'reservation', cases: [
    { label: 'Hueco exacto', capacity: 130, alreadyReserved: 20, requests: [120, 100, 10, 1] },
    { label: 'Ocupado', capacity: 130, alreadyReserved: 130, requests: [1, 130] },
  ] }
  expect(validSwitchingProfile(profile)).toBe(true)
  expect(answers(profile, 'Hueco exacto')).toEqual(['NSSN', '0'])
  expect(answers(profile, 'Ocupado')).toEqual(['NN', '0'])
  const first = describeSwitching(profile, ['Hueco exacto']).answers[0]
  expect(matchesPredictionAnswer(first, 'n, s, s, n')).toBe(true)
  expect(matchesPredictionAnswer(first, 'ssnn')).toBe(false)
})

it('distinguishes transmission scope from a lost copy in the logical LAN', () => {
  const profile: SwitchingProfile = { kind: 'delivery' }
  expect(answers(profile, 'Router IPv4', 'Sin pérdida declarada')).toEqual(['No', 'Solo B'])
  expect(answers(profile, 'Router IPv4', 'Pérdida en el enlace de C')).toEqual(['No', 'Solo B'])
  expect(answers(profile, 'Una LAN lógica', 'Sin pérdida declarada')).toEqual(['Sí', 'B y C'])
  expect(answers(profile, 'Una LAN lógica', 'Pérdida en el enlace de C')).toEqual(['Sí', 'Solo B'])
})

it('rejects invalid scenarios and restores the exact variant and valid trace position', () => {
  const [first, second] = timing.cases
  expect(validSwitchingProfile(timing)).toBe(true)
  for (const cases of [
    [first], [first, { ...second, label: first.label }], [first, { ...second, label: ' ' }],
    [first, { ...second, links: [{ bitsPerMs: 0, propagationMs: 0 }, second.links[1]] }],
    [first, { ...second, links: [{ bitsPerMs: 1000, propagationMs: -1 }, second.links[1]] }],
    [first, { ...second, headerBits: 1 }], [first, { ...second, packets: 3 }],
    [first, { ...second, links: Array(5).fill(second.links[0]) }],
  ]) expect(validSwitchingProfile({ ...timing, cases })).toBe(false)
  expect(validSwitchingProfile({ kind: 'reservation', cases: [
    { label: 'A', capacity: 15, alreadyReserved: 16, requests: [1, 1] },
    { label: 'B', capacity: 15, alreadyReserved: 0, requests: [1, 1] },
  ] })).toBe(false)
  const saved = { controls: ['Cabecera larga', 'Paquetes'], answers: ['8000', '14', '26'], step: 9 }
  const read = (value: unknown) => parsePredictionDraft(JSON.stringify(value), switchingControls(timing),
    controls => describeSwitching(timing, controls))
  expect(read(saved)).toEqual(saved)
  expect(read({ ...saved, step: 12 })).not.toHaveProperty('step')
  expect(read({ ...saved, controls: ['Desconocido', 'Paquetes'] }))
    .toEqual({ controls: ['Salida lenta', 'Mensaje completo'], answers: ['', '', ''] })
})
