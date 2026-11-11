import { describe, expect, it } from 'vitest'
import { parsePredictionDraft } from './prediction'
import { describeVlsm, validVlsmProfile, vlsmControls, type VlsmProfile } from './vlsm-model'

const profile: VlsmProfile = { scenarios: [
  { label: 'Inventario', parent: '192.0.2.0/24', occupied: ['192.0.2.128/26', '192.0.2.0/26'], demands: [
    { name: 'LAN', kind: 'lan', count: 70 },
    { name: 'Enlace', kind: 'p2p', count: 2 },
    { name: 'Destino', kind: 'host', count: 1 },
  ] },
  { label: 'Extremos', parent: '0.0.0.0/0', occupied: ['0.0.0.0/1'], demands: [
    { name: 'LAN', kind: 'lan', count: 2 ** 31 - 1 },
    { name: 'Destino', kind: 'host', count: 1 },
  ] },
] }

describe('VLSM prediction', () => {
  it('keeps disjoint gaps separate and continues after an unallocated demand', () => {
    expect(validVlsmProfile(profile)).toBe(true)
    const exercise = describeVlsm(profile, ['Inventario'])
    expect(exercise.answers.map(answer => answer.expected))
      .toEqual(['25', 'Sin bloque alineado', '31', '192.0.2.64/31', '32', '192.0.2.66/32'])
    expect(exercise.trace?.[0]).toContain('ninguna de las 2 bases alineadas')
    expect(exercise.trace?.[2]).toContain('192.0.2.66–192.0.2.66')
  })

  it('rounds above a power of two without scanning the IPv4 range', () => {
    expect(describeVlsm(profile, ['Extremos']).answers.map(answer => answer.expected))
      .toEqual(['0', 'Sin bloque alineado', '32', '128.0.0.0/32'])
    const terminal = structuredClone(profile)
    terminal.scenarios[0].parent = '255.255.255.254/31'
    terminal.scenarios[0].occupied = ['255.255.255.254/32']
    const exercise = describeVlsm(terminal, ['Inventario'])
    expect(exercise.answers.map(answer => answer.expected))
      .toEqual(['25', 'Sin bloque alineado', '31', 'Sin bloque alineado', '32', '255.255.255.255/32'])
    expect(exercise.trace?.[0]).toContain('mayor que el bloque padre')
  })

  it('rejects malformed, overlapping or out-of-parent blocks and inconsistent demands', () => {
    for (const occupied of [
      ['192.0.2.1/26'], ['192.0.2.0/26', '192.0.2.0/27'], ['192.0.3.0/25'], ['192.0.2.0/33'], ['192.0.2.0/ 26'],
    ]) {
      const invalid = structuredClone(profile)
      invalid.scenarios[0].occupied = occupied
      expect(validVlsmProfile(invalid)).toBe(false)
    }
    const invalid = structuredClone(profile)
    invalid.scenarios[0].demands[1].count = 3
    expect(validVlsmProfile(invalid)).toBe(false)
  })

  it('recovers the selected scenario, dynamic answers and only an in-range trace step', () => {
    const controls = vlsmControls(profile)
    const parse = (raw: unknown) => parsePredictionDraft(JSON.stringify(raw), controls, values => describeVlsm(profile, values))
    const answers = ['0', 'Sin bloque alineado', '32', '128.0.0.0/32']
    expect(parse({ controls: ['Extremos'], answers, step: 1 })).toEqual({ controls: ['Extremos'], answers, step: 1 })
    expect(parse({ controls: ['Extremos'], answers, step: 2 }).step).toBeUndefined()
    expect(parse({ controls: ['Otro'], answers, step: 1 })).toEqual({ controls: ['Inventario'], answers: Array(6).fill('') })
  })
})
