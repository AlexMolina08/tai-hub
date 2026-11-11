import { expect, test } from 'vitest'
import { describeInterleaving, interleavingControls, runInterleaving, validInterleavingProfile } from './interleaving-model'
import { matchesPredictionAnswer, parsePredictionDraft } from './prediction'

const profile = { initial: 2, deltaA: 4, deltaB: 6, synchronized: false }
const overlapping = ['read-a', 'read-b', 'write-a', 'write-b']
const serial = ['read-a', 'write-a', 'read-b', 'write-b']

test('la última escritura con una lectura anterior pierde un incremento', () => {
  expect(runInterleaving(profile, overlapping)).toMatchObject({ completed: true, counter: 8, lostUpdate: true })
  expect(runInterleaving(profile, ['read-a', 'read-b', 'write-b', 'write-a'])).toMatchObject({ counter: 6, lostUpdate: true })
  expect(runInterleaving(profile, serial)).toMatchObject({ completed: true, counter: 12, lostUpdate: false })
})

test('un monitor conserva el estado ante intentos bloqueados y permite reintentar', () => {
  const synchronized = { ...profile, synchronized: true }
  const incomplete = runInterleaving(synchronized, ['read-a', 'read-b', 'write-b'])
  expect(incomplete).toMatchObject({ completed: false, counter: 2, lostUpdate: null })
  expect(incomplete.trace.map(step => step.status)).toEqual(['accepted', 'blocked', 'needs-read'])
  const finished = runInterleaving(synchronized, ['read-a', 'read-b', 'write-a', 'read-b', 'write-b', 'write-b', 'invalid'])
  expect(finished.trace.map(step => step.status)).toEqual(['accepted', 'blocked', 'accepted', 'accepted', 'accepted', 'already-done', 'unsupported'])
  expect(finished).toMatchObject({ completed: true, counter: 12, lostUpdate: false })
})

test('el perfil acepta solo enteros dentro de los límites y el booleano de monitor', () => {
  expect(validInterleavingProfile({ initial: 100, deltaA: 1, deltaB: 20, synchronized: true })).toBe(true)
  for (const candidate of [
    null, [], {}, { ...profile, initial: -1 }, { ...profile, initial: 101 }, { ...profile, initial: 2.5 },
    { ...profile, deltaA: 0 }, { ...profile, deltaB: 21 }, { ...profile, deltaB: '6' },
    { ...profile, synchronized: 0 }, { ...profile, schedule: serial },
  ]) expect(validInterleavingProfile(candidate)).toBe(false)
})

test('se recuperan la secuencia y predicción, y se exige completar ambas escrituras', () => {
  const controls = interleavingControls(profile)
  const describe = (values: string[]) => describeInterleaving(profile, values)
  const initial = parsePredictionDraft('', controls, describe)
  expect(describe(initial.controls).ready).toBe(false)
  const chosen = ['0', 'A lee el contador', 'B lee el contador', 'A escribe su resultado', 'B escribe su resultado',
    ...initial.controls.slice(5)]
  const saved = { controls: chosen, answers: ['8', 'Sí'], step: 3 }
  const draft = parsePredictionDraft(JSON.stringify(saved), controls, describe)
  expect(draft).toEqual(saved)
  const result = describe(draft.controls)
  expect(result.ready).toBe(true)
  expect(result.answers.every((answer, index) => matchesPredictionAnswer(answer, draft.answers[index]))).toBe(true)
  expect(describe(['1', ...chosen.slice(1)]).ready).toBe(false)
})
