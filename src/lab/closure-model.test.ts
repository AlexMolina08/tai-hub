import { expect, it } from 'vitest'
import { attributeClosure, candidateKeys, closureControls, describeClosure, validClosureProfile, type ClosureProfile } from './closure-model'
import { matchesPredictionAnswer, parsePredictionDraft, validPredictionAnswer } from './prediction'

const profile: ClosureProfile = {
  kind: 'keys', attributes: ['A','B','C','D'],
  dependencies: [{ from: ['A'], to: ['B'] }, { from: ['B'], to: ['A'] }, { from: ['C'], to: ['D'] }],
  initial: ['A','C'],
}

it('reaches a fixed point even when the requested step cannot fire', () => {
  const dependencies = [{ from: ['B'], to: ['C'] }, { from: ['A'], to: ['B'] }, { from: ['C'], to: ['A'] }]
  const result = attributeClosure(['A'], dependencies, [dependencies[0], dependencies[1], dependencies[1]])
  expect(result.closure).toEqual(['A','B','C'])
  expect(result.steps).toEqual([
    'Conjunto inicial A.',
    'B → C aún no se puede aplicar. Falta un atributo de su lado izquierdo.',
    'Con A → B se añade B. El conjunto pasa a AB.',
    'A → B no añade atributos. Su lado derecho ya está incluido.',
    'Con B → C se añade C. El conjunto pasa a ABC.',
    'Ninguna regla añade más atributos. El cierre es ABC.',
  ])
})

it('finds all minimal keys and excludes supersets of them', () => {
  expect(candidateKeys(profile.attributes, profile.dependencies)).toEqual([['A','C'],['B','C']])
  expect(candidateKeys(['A','B'], [{ from: [], to: ['A','B'] }])).toEqual([[]])
  expect(candidateKeys(['A','B'], [])).toEqual([['A','B']])
  const exercise = describeClosure(profile,['1','0','1','0','B → A','Orden automático','Orden automático'])
  expect(exercise.answers.map(a=>a.expected)).toEqual(['ABCD','Sí','AC / BC'])
  expect(matchesPredictionAnswer(exercise.answers[0],'d c, b a')).toBe(true)
  expect(matchesPredictionAnswer(exercise.answers[2],'cb / ca')).toBe(true)
  expect(matchesPredictionAnswer(exercise.answers[2],'AC/BC/ABC')).toBe(false)
  expect(validPredictionAnswer(exercise.answers[2],'AC/CA')).toBe(false)
})

it('validates attributes and restores a trace step only for a valid draft', () => {
  expect(validClosureProfile(profile)).toBe(true)
  for (const invalid of [
    { ...profile, initial: ['X'] },
    { ...profile, dependencies: [{ from: ['A'], to: ['X'] }] },
    { ...profile, dependencies: [{ from: ['A'], to: [] }] },
    { ...profile, dependencies: [{ from: ['A','B'], to: ['D'] }, { from: ['B','A'], to: ['D'] }] },
  ]) expect(validClosureProfile(invalid)).toBe(false)
  const controls = ['0','0','0','0','Orden automático','Orden automático','Orden automático']
  const answers = ['-','No','AC/BC']
  const schema = closureControls(profile)
  const parse = (value: unknown) => parsePredictionDraft(JSON.stringify(value), schema, values => describeClosure(profile,values))
  expect(parse({controls,answers,step:1})).toEqual({controls,answers,step:1})
  expect(parse({controls,answers,step:2})).toEqual({controls,answers})
  expect(parse({controls:['bogus'],answers,step:1}).answers).toEqual(['','',''])
})
