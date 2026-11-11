import { describe, expect, it } from 'vitest'
import { samplePackage } from './fixtures.test-support'
import { isPredictionActivity } from './prediction'
import { describeServiceCapacity, SERVICE_CAPACITY_MODEL_VERSION, serviceCapacityControls, validServiceCapacityProfile } from './service-capacity-model'
import { parsePackage } from './validate'

const window = { label: 'Banco de prueba', demand: 90, edgeHits: 30, replicaSlots: [50, 25], dataSlots: 60, entries: 1 as const }
const failure = { kind: 'failure' as const, cases: [window, { ...window, label: 'Segunda entrada', entries: 2 as const }] }
const answers = (configuration: string, fault: string) => describeServiceCapacity(failure, [configuration, fault]).answers.map(answer => answer.expected)

describe('service capacity model', () => {
  it('accounts for the remaining entry, replica, cache and data capacity separately', () => {
    expect(answers(window.label, 'Sin fallo')).toEqual(['90', '0', 'Demanda cubierta'])
    expect(answers(window.label, 'Una entrada')).toEqual(['0', '90', 'Entrada'])
    expect(answers('Segunda entrada', 'Una entrada')).toEqual(['90', '0', 'Demanda cubierta'])
    expect(answers(window.label, 'Réplica 1')).toEqual(['55', '35', 'Réplicas de aplicación'])
    expect(answers(window.label, 'Caché de borde')).toEqual(['60', '30', 'Almacén de datos'])
    expect(answers(window.label, 'Almacén de datos')).toEqual(['30', '60', 'Almacén de datos'])
  })

  it('keeps the fault choices valid across configurations', () => {
    expect(serviceCapacityControls(failure).map(control => control.initial)).toEqual([window.label, 'Sin fallo'])
    expect(validServiceCapacityProfile({ ...failure, cases: [window, { ...window, label: 'Otra', replicaSlots: [10] }] })).toBe(false)
    expect(validServiceCapacityProfile({ ...failure, cases: [{ ...window, edgeHits: 91 }, failure.cases[1]] })).toBe(false)
  })

  it('imports only the supported simulation edition as a practice', () => {
    const pack = samplePackage()
    const activity = pack.activities[0]
    pack.activities[0] = { ...activity, kind: 'service-capacity-model', phase: 'practice', profile: failure,
      mode: { kind: 'simulation', engine: 'Prueba de capacidad', version: SERVICE_CAPACITY_MODEL_VERSION, limits: 'Una ventana sintética.' } }
    expect(isPredictionActivity(parsePackage(pack).activities[0])).toBe(true)
    pack.activities[0].mode.version = 'unsupported'
    expect(() => parsePackage(pack)).toThrow(/perfil de capacidad de servicio inválido/)
  })
})
