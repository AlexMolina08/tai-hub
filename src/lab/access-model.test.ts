import { expect, it } from 'vitest'
import { ACCESS_MODEL_VERSION, accessControls, describeAccess, type AccessProfile } from './access-model'
import { samplePackage } from './fixtures.test-support'
import { parsePredictionDraft } from './prediction'
import { parsePackage } from './validate'

const copper = { kind: 'line', medium: 'copper' } as const
const fiber = { kind: 'line', medium: 'fiber' } as const
const ethernet = { kind: 'ethernet' } as const
const outcomes = (profile: AccessProfile, ...values: string[]) =>
  describeAccess(profile, values).answers.map(answer => answer.expected)

it('requires the corresponding subscriber and provider termination even with an unbroken medium', () => {
  expect(outcomes(copper, 'Módem xDSL', 'Puerto xDSL del DSLAM', 'Puente', '0')).toEqual(['Sí', 'Sí'])
  expect(outcomes(copper, 'Módem xDSL', 'Puerto PON de la OLT', 'Puente', '0')).toEqual(['No', 'No'])
  expect(outcomes(copper, 'ONT', 'Puerto xDSL del DSLAM', 'Puente', '0')).toEqual(['No', 'No'])
  expect(outcomes(fiber, 'ONT', 'Puerto PON de la OLT', 'Router', '0')).toEqual(['Sí', 'No'])
  expect(outcomes(fiber, 'Módem xDSL', 'Puerto xDSL del DSLAM', 'Puente', '0')).toEqual(['No', 'No'])
  expect(outcomes(fiber, 'ONT', 'Puerto PON de la OLT', 'Puente', '1')).toEqual(['No', 'No'])
})

it('separates an Ethernet collision domain, a routed boundary and a disconnected branch', () => {
  expect(outcomes(ethernet, 'Hub', 'Puente', '0', '0')).toEqual(['Sí', 'Sí', 'Sí'])
  expect(outcomes(ethernet, 'Hub', 'Router', '0', '0')).toEqual(['Sí', 'No', 'Sí'])
  expect(outcomes(ethernet, 'Switch', 'Puente', '0', '0')).toEqual(['Sí', 'Sí', 'No'])
  expect(outcomes(ethernet, 'Switch', 'Puente', '0', '1')).toEqual(['Sí', 'No', 'No'])
  expect(outcomes(ethernet, 'Hub', 'Puente', '1', '0')).toEqual(['No', 'No', 'No'])
  expect(outcomes(ethernet, 'Switch', 'Router', '1', '1')).toEqual(['No', 'No', 'No'])
})

it('restores a broken route and clears a draft if its control tuple is unsupported', () => {
  const parse = (raw: string) => parsePredictionDraft(raw, accessControls(ethernet), values => describeAccess(ethernet, values))
  const saved = { controls: ['Hub', 'Puente', '0', '1'], answers: ['Sí', 'No', 'Sí'] }
  expect(parse(JSON.stringify(saved))).toEqual(saved)
  expect(parse(JSON.stringify({ ...saved, controls: ['Hub', 'Puente', '0', '2'] })))
    .toEqual({ controls: ['Switch', 'Router', '0', '0'], answers: ['', '', ''] })
  expect(parse('null')).toEqual(parse('{'))
})

it('checks the access package profile, practice phase and scoring version', () => {
  const pack = samplePackage()
  const sample = { ...pack.activities[0], kind: 'access-model', phase: 'practice', profile: copper,
    mode: { ...pack.activities[0].mode, kind: 'simulation', version: ACCESS_MODEL_VERSION } }
  const withActivity = (activity: unknown) => ({ ...pack, activities: [activity, ...pack.activities.slice(1)] })
  expect(() => parsePackage(withActivity(sample), 'study')).not.toThrow()
  for (const invalid of [
    { ...sample, profile: { kind: 'line' } },
    { ...sample, profile: { kind: 'line', medium: 'coax' } },
    { ...sample, phase: 'reserved' },
    { ...sample, mode: { ...sample.mode, version: 'access-model-v2' } },
  ]) expect(() => parsePackage(withActivity(invalid), 'authoring')).toThrow('perfil de acceso inválido')
})
