import { describe, expect, it } from 'vitest'
import { samplePackage } from './fixtures.test-support'
import { isPredictionActivity, parsePredictionDraft } from './prediction'
import { CONTENTION_MODEL_VERSION, contentionControls, describeContention, validContentionProfile, type ContentionProfile } from './contention-model'
import { parsePackage } from './validate'

type Scenario = ContentionProfile['scenarios'][number]
const visible: Scenario = { kind: 'wireless', label: 'Radio local', access: 'basic', hidden: false,
  waits: [3, 0], busySlots: 2, ackLost: true }
const hidden: Scenario = { kind: 'wireless', label: 'Estaciones distantes', access: 'rts-cts', hidden: true,
  waits: [1, 3], busySlots: 1, ctsAudible: true, ackLost: false }

function explain(row: Scenario) {
  return describeContention({ scenarios: [row] }, [row.label])
}

const results = (row: Scenario) => explain(row).answers.map(a => a.expected)

describe('contention prediction', () => {
  it('distinguishes port carrier, collision and full-duplex operation', () => {
    const row = { kind: 'ethernet', label: 'Segmento', duplex: 'shared', ready: [1, 0] } satisfies Scenario
    expect(results(row)).toEqual(['B transmite primero', 'A difiere por portadora'])
    expect(results({ ...row, ready: [0, 0], retry: [1, 0] })).toEqual(['Colisión', 'B reintenta primero'])
    expect(results({ ...row, ready: [0, 0], duplex: 'full' })).toEqual(['Simultáneo sin colisión', 'Sin backoff de colisión'])
    expect(results({ ...row, duplex: 'full' })).toEqual(['B transmite primero', 'Sin backoff de colisión'])
  })

  it('reports a new collision on equal retry draws and the larger following window', () => {
    const caseResult = explain({ kind: 'ethernet', label: 'Dos intentos', duplex: 'shared', ready: [0, 0], retry: [0, 0] })
    expect(caseResult.answers.map(a => a.expected)).toEqual(['Colisión', 'Segunda colisión'])
    expect(caseResult.trace?.[1]).toContain('0 y 1 ranuras')
    expect(caseResult.trace?.[2]).toContain('0 a 3 ranuras')
  })

  it('freezes counters during busy slots and separates reception from lost ACK', () => {
    const caseResult = explain(visible)
    expect(caseResult.answers.map(a => a.expected)).toEqual(['Datos de B recibidos', 'Espera por portadora', 'Sin confirmar'])
    expect(caseResult.trace?.[0]).toContain('2 ranuras ocupadas')
    expect(caseResult.trace?.[0]).toContain('conservan sus valores')
    expect(results({ ...visible, ackLost: false })).toEqual(['Datos de B recibidos', 'Espera por portadora', 'Confirmada'])
  })

  it('distinguishes hidden DATA collisions, a decoded CTS, an overlapping RTS and tied RTS', () => {
    expect(results({ ...visible, hidden: true, waits: [1, 2] })).toEqual([
      'Colisión de datos', 'Intenta sin protección', 'Sin confirmar',
    ])
    expect(results(hidden)).toEqual(['Datos de A recibidos', 'Espera por NAV', 'Confirmada'])
    expect(results({ ...hidden, ctsAudible: false })).toEqual([
      'Solapamiento de datos y RTS', 'Intenta sin protección', 'Sin confirmar',
    ])
    expect(results({ ...hidden, waits: [3, 3] })).toEqual(['Colisión de RTS', 'Intento simultáneo', 'Sin confirmar'])
    expect(results({ ...visible, waits: [1, 1] })).toEqual(['Colisión de datos', 'Intento simultáneo', 'Sin confirmar'])
  })

  it('rejects unbounded or contradictory inputs', () => {
    const profile = { scenarios: [visible, hidden] }
    expect(validContentionProfile(profile)).toBe(true)
    for (const invalid of [
      { ...visible, ctsAudible: true }, { ...hidden, ctsAudible: undefined },
      { ...visible, waits: [4, 0] }, { ...visible, busySlots: -1 }, { ...visible, busySlots: 5 },
      { ...visible, waits: [0.5, 0] },
      { kind: 'ethernet', label: 'Empate sin sorteo', duplex: 'shared', ready: [1, 1] },
      { kind: 'ethernet', label: 'Sorteo imposible', duplex: 'shared', ready: [0, 0], retry: [0, 2] },
      { kind: 'ethernet', label: 'Sorteo en full', duplex: 'full', ready: [0, 0], retry: [0, 0] },
    ]) {
      expect(validContentionProfile({ scenarios: [invalid, hidden] })).toBe(false)
    }
    expect(validContentionProfile({ scenarios: [visible, { ...hidden, label: visible.label }] })).toBe(false)
  })

  it('uses the standard prediction activity and recovers a trace step and draft', () => {
    const profile = { scenarios: [visible, hidden] }
    const pack = samplePackage()
    pack.activities[0] = { ...pack.activities[0], kind: 'contention-model', phase: 'practice', profile,
      mode: { kind: 'simulation', version: CONTENTION_MODEL_VERSION, engine: 'Modelo de acceso', limits: 'Trazas sintéticas' } }
    expect(isPredictionActivity(parsePackage(pack).activities[0])).toBe(true)
    expect(() => parsePackage({ ...pack, activities: [{ ...pack.activities[0], phase: 'reserved' }, ...pack.activities.slice(1)] }, 'authoring'))
      .toThrow('perfil de acceso al medio inválido')
    const controls = contentionControls(profile)
    const recover = (value: unknown) => parsePredictionDraft(JSON.stringify(value), controls, values => describeContention(profile, values))
    const draft = { controls: [hidden.label], answers: results(hidden), step: 2 }
    expect(recover(draft)).toEqual(draft)
    expect(recover({ ...draft, step: 15 }).step).toBeUndefined()
  })
})
