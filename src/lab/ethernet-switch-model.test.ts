import { describe, expect, it } from 'vitest'
import {
  describeEthernetSwitch, ethernetSwitchControls, ETHERNET_SWITCH_MODEL_VERSION, validEthernetSwitchProfile,
  type EthernetSwitchProfile,
} from './ethernet-switch-model'
import { samplePackage } from './fixtures.test-support'
import { isPredictionActivity, matchesPredictionAnswer, parsePredictionDraft } from './prediction'
import { parsePackage } from './validate'

type Scenario = EthernetSwitchProfile['cases'][number]
const sequence = {
  kind: 'fdb', label: 'Recepción secuencial', age: 20,
  ports: [
    { number: 1, vlans: [4, 5], blockedVlans: [] },
    { number: 2, vlans: [4], blockedVlans: [] },
    { number: 3, vlans: [4], blockedVlans: [] },
    { number: 4, vlans: [4], blockedVlans: [4] },
    { number: 5, vlans: [5], blockedVlans: [] },
  ],
  initial: [{ vlan: 4, mac: 'C', port: 3 }, { vlan: 5, mac: 'B', port: 5 }],
  frames: [
    { time: 0, vlan: 4, ingress: 1, source: 'A', destination: 'B' },
    { time: 19, vlan: 4, ingress: 2, source: 'B', destination: 'A' },
    { time: 20, vlan: 4, ingress: 2, source: 'B', destination: 'A' },
    { time: 21, vlan: 4, ingress: 2, source: 'A', destination: 'C' },
    { time: 22, vlan: 4, ingress: 2, source: 'B', destination: 'A' },
    { time: 23, vlan: 4, ingress: 2, source: 'A', destination: '*' },
  ],
  questions: [
    { frame: 1, field: 'outputs' }, { frame: 2, field: 'outputs' }, { frame: 3, field: 'outputs' },
    { frame: 4, field: 'outputs' }, { frame: 5, field: 'outputs' }, { frame: 6, field: 'outputs' },
  ],
} satisfies Scenario
const time = {
  kind: 'timing', label: 'Instantes de comprobación', bitsPerMicrosecond: 100, frameBytes: 1000,
  decisionBytes: 75, validFcs: false,
} satisfies Scenario
const topology = {
  kind: 'loop', label: 'Vista del anillo', vlan: 77, start: 'S', links: [
    { a: 'S', b: 'T', vlans: [77], blockedVlans: [] },
    { a: 'T', b: 'U', vlans: [77], blockedVlans: [] },
    { a: 'U', b: 'S', vlans: [77, 78], blockedVlans: [77] },
    { a: 'T', b: 'V', vlans: [78], blockedVlans: [] },
  ],
} satisfies Scenario

function explain(item: Scenario) {
  return describeEthernetSwitch({ cases: [item] }, [item.label])
}
const outputs = (item: Scenario) => explain(item).answers.map(answer => answer.expected)

describe('Ethernet switch prediction', () => {
  it('learns origins by VLAN and distinguishes unknown, known, filtered and broadcast', () => {
    const description = explain(sequence)
    expect(outputs(sequence)).toEqual(['2,3', '1', '1,3', '3', '-', '1,3'])
    expect(description.trace?.[2]).toContain('Caducan 4/A')
    expect(description.trace?.[3]).toContain('4/A→2')
    expect(description.trace?.[5]).toContain('Broadcast.')
    expect(matchesPredictionAnswer(description.answers[0], '2, 3')).toBe(true)
    expect(matchesPredictionAnswer(description.answers[0], '2,3,4')).toBe(false)
    expect(matchesPredictionAnswer(description.answers[4], '-')).toBe(true)
  })

  it('exposes the learned port and treats a static row separately at the exact aging boundary', () => {
    const sample = { ...sequence, questions: [
      { frame: 2, field: 'learnedPort', mac: 'A' },
      { frame: 3, field: 'learnedPort', mac: 'A' },
      { frame: 4, field: 'learnedPort', mac: 'A' },
      { frame: 6, field: 'learnedPort', mac: 'C' },
    ] } satisfies Scenario
    expect(outputs(sample)).toEqual(['1', '0', '2', '3'])
  })

  it('keeps the FCS decision and beginning of egress separate', () => {
    expect(outputs(time)).toEqual(['6', '80', 'Sí', 'No'])
    expect(outputs({ ...time, validFcs: true })).toEqual(['6', '80', 'Sí', 'Sí'])
  })

  it('checks cycles only within the forwarding component of the chosen VLAN', () => {
    expect(outputs(topology)).toEqual(['No', '2'])
    const links = topology.links.map(link => ({ ...link, blockedVlans: [] }))
    expect(outputs({ ...topology, links })).toEqual(['Sí', '3'])
    expect(outputs({ ...topology, links: [...topology.links, { a: 'S', b: 'T', vlans: [77], blockedVlans: [] }] }))
      .toEqual(['Sí', '3'])
    expect(outputs({ ...topology, start: 'V' })).toEqual(['No', '0'])
  })

  it('rejects invalid event order, scope, rows and questions', () => {
    expect(validEthernetSwitchProfile({ cases: [sequence, time, topology] })).toBe(true)
    for (const invalid of [
      { ...sequence, ports: [...sequence.ports, sequence.ports[0]] },
      { ...sequence, initial: [...sequence.initial, sequence.initial[0]] },
      { ...sequence, initial: [{ vlan: 5, mac: 'E', port: 2 }] },
      { ...sequence, frames: [{ ...sequence.frames[0], ingress: 4 }] },
      { ...sequence, frames: [...sequence.frames, sequence.frames[0]] },
      { ...sequence, questions: [{ frame: 0, field: 'outputs' }] },
      { ...sequence, questions: [sequence.questions[0], sequence.questions[0]] },
      { ...time, decisionBytes: 12 },
      { ...topology, links: [{ a: 'S', b: 'S', vlans: [77], blockedVlans: [] }] },
      { ...topology, links: [{ a: 'S', b: 'T', vlans: [77], blockedVlans: [78] }] },
    ]) expect(validEthernetSwitchProfile({ cases: [invalid] })).toBe(false)
  })

  it('uses the common package validation, activity recognition and draft recovery', () => {
    const profile = { cases: [sequence, time] }
    const pack = samplePackage()
    pack.activities[0] = { ...pack.activities[0], kind: 'ethernet-switch-model', phase: 'practice', profile,
      mode: { kind: 'simulation', version: ETHERNET_SWITCH_MODEL_VERSION, engine: 'Conmutación Ethernet', limits: 'Trazas sintéticas' } }
    expect(isPredictionActivity(parsePackage(pack).activities[0])).toBe(true)
    expect(() => parsePackage({ ...pack, activities: [{ ...pack.activities[0], phase: 'reserved' }, ...pack.activities.slice(1)] }, 'authoring'))
      .toThrow('perfil de conmutación Ethernet inválido')
    const controls = ethernetSwitchControls(profile)
    const draft = { controls: [time.label], answers: ['6', '80', 'Sí', 'No'], step: 1 }
    expect(parsePredictionDraft(JSON.stringify(draft), controls, values => describeEthernetSwitch(profile, values))).toEqual(draft)
  })
})
