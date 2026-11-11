import { expect, it } from 'vitest'
import { algorithmControls, describeAlgorithm, traceDiscipline, traceInsertion, traceSearch, traceTree, validAlgorithmProfile, type AlgorithmProfile } from './algorithm-model'
import { matchesPredictionAnswer, parsePredictionDraft } from './prediction'

it('distinguishes LIFO from FIFO and reports removal from an empty structure', () => {
  const input = ['remove', 4, 8, 'remove', 'remove', 'remove'] as const
  expect(traceDiscipline('stack', [...input])).toMatchObject({ removed: [8, 4], pending: [], empty: 2 })
  expect(traceDiscipline('queue', [...input])).toMatchObject({ removed: [4, 8], pending: [], empty: 2 })
  const profile: AlgorithmProfile = { kind: 'discipline', sequences: [
    { label: 'Corta', values: [4, 'remove'] }, { label: 'Alternada', values: [...input] },
  ] }
  const pending = describeAlgorithm(profile, ['Pila', 'Corta']).answers[1]
  expect(matchesPredictionAnswer(pending, '-')).toBe(true)
  expect(matchesPredictionAnswer(pending, '4')).toBe(false)
})

it('preserves in-order keys and distinct roots for successor and predecessor deletion', () => {
  const keys = [7, 2, 11, 4, 9]
  expect(traceTree(keys, { kind: 'successor', key: 7 }, 'Preorden')).toMatchObject({ root: 9, visits: [9,2,4,11] })
  expect(traceTree(keys, { kind: 'predecessor', key: 7 }, 'Postorden')).toMatchObject({ root: 4, visits: [2,9,11,4] })
  expect(traceTree(keys, { kind: 'insert', key: 3 }, 'Inorden')).toMatchObject({ root: 7, visits: [2,3,4,7,9,11] })
  expect(traceTree(keys, { kind: 'successor', key: 2 }, 'Preorden')).toMatchObject({ root: 7, visits: [7,4,11,9] })
})

it('counts examined positions and comparisons under the declared search and insertion rules', () => {
  const sorted = [1,5,7,9,11]
  expect(traceSearch(sorted, 9, false)).toMatchObject({ found: 3, inspected: [1,5,7,9] })
  expect(traceSearch(sorted, 9, true)).toMatchObject({ found: 3, inspected: [7,9] })
  expect(traceSearch(sorted, 8, true)).toMatchObject({ found: -1, inspected: [7,9] })
  expect(traceInsertion([7,1,5,0])).toMatchObject({ values: [0,1,5,7], firstPass: [1,7,5,0], comparisons: 6, swaps: 5 })
  expect(traceInsertion([1,2,2,3])).toMatchObject({ values: [1,2,2,3], comparisons: 3, swaps: 0 })
  expect(traceInsertion([4,3,2,1])).toMatchObject({ values: [1,2,3,4], comparisons: 6, swaps: 6 })
})

it('requires bounded scenarios and restores the case-specific answer fields', () => {
  const profile: AlgorithmProfile = {
    kind: 'comparison', sorted: [0, 3, 8], present: 3, absent: 4,
    sorts: [{ label: 'Una inversión', values: [4,3,9] }, { label: 'Iguales', values: [1,1] }],
  }
  expect(validAlgorithmProfile(profile)).toBe(true)
  for (const invalid of [
    { ...profile, sorted: [3,0,8] }, { ...profile, absent: 3 }, { ...profile, sorts: [{ label: 'Una', values: [4,3] }] },
    { kind: 'tree', keys: [0,3,8], add: 1, remove: 3 }, { kind: 'tree', keys: [3,0,8,8], add: 1, remove: 3 },
  ]) expect(validAlgorithmProfile(invalid)).toBe(false)
  const parse = (value: unknown) => parsePredictionDraft(JSON.stringify(value), algorithmControls(profile), values => describeAlgorithm(profile, values))
  const saved = { controls: ['Inserción · Una inversión'], answers: ['3, 4, 9','2','1'], step: 2 }
  expect(parse(saved)).toEqual(saved)
  expect(parse({ ...saved, controls: ['unknown'] }).answers).toEqual(['','',''])
})
