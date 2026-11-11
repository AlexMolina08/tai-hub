import { describe, expect, it } from 'vitest'
import { samplePackage } from './fixtures.test-support'
import {
  describeLanVlan, lanVlanControls, LAN_VLAN_MODEL_VERSION, validLanVlanProfile, type LanVlanProfile,
} from './lan-vlan-model'
import { isPredictionActivity, parsePredictionDraft } from './prediction'
import { parsePackage } from './validate'

type Scenario = LanVlanProfile['cases'][number]
const tag = {
  kind: 'tag', label: 'Lado de acceso y troncal',
  ingress: { kind: 'access', pvid: 10, voice: 20, priorityTagged: false },
  wireVid: 20, destination: 20,
  tx: { kind: 'trunk', native: 99, allowed: [10,20,99], tagNative: false, admitUntagged: true },
  rx: { kind: 'trunk', native: 99, allowed: [10,20,99], tagNative: false, admitUntagged: true },
} satisfies Scenario
const tci = { kind: 'tci', label: 'Lectura del control', word: 0xb065, pvid: 10 } satisfies Scenario
const qos = { kind: 'qos', label: 'Política local', pcp: 5, dei: 1, dscp: 46, classifier: 'pcp',
  trusted: true, remark: 1, queues: { '1': 1, '5': 3 }, dropDei: true, congested: true, permitted: true } satisfies Scenario
const route = {
  kind: 'route', label: 'Destino en otra VLAN', topology: 'router-on-a-stick',
  source: { vlan: 14, address: '192.0.2.14/27', gateway: '192.0.2.1', connected: true },
  destination: { vlan: 16, address: '198.51.100.144/27', gateway: '198.51.100.129', connected: true },
  interfaces: [
    { name: 'G0/1.1', vlan: 14, address: '192.0.2.1/27', active: true },
    { name: 'G0/1.2', vlan: 16, address: '198.51.100.129/27', active: true },
  ],
  allowed: [14,16], forwarding: true, permitted: true,
} satisfies Scenario
const relay = { kind: 'relay', label: 'Descubrimiento por relay', clientVlan: 33, clientSvi: '192.0.2.65/26',
  serverVlan: 34, serverAddress: '198.51.100.15', helper: '198.51.100.15', routeOut: true, routeBack: true } satisfies Scenario

const explain = (scenario: Scenario) => describeLanVlan({ cases: [scenario] }, [scenario.label])
const predict = (scenario: Scenario) => explain(scenario).answers.map(answer => answer.expected)

describe('LAN VLAN prediction', () => {
  it('classifies voice, native and priority-tagged ingress independently from the wire tag', () => {
    expect(predict(tag)).toEqual(['20', '20', '20', 'Sí'])
    expect(predict({ ...tag, wireVid: 0 })).toEqual(['0', 'Sin salida', '0', 'No'])
    const priority = { ...tag, wireVid: 0, destination: 10, ingress: { ...tag.ingress, voice: null, priorityTagged: true } }
    expect(predict(priority)).toEqual(['10', '10', '10', 'Sí'])
    const tx = { ...tag.tx, native: 10 }
    expect(predict({ ...priority, tx })).toEqual(['10', 'Sin etiqueta', '99', 'No'])
    expect(predict({ ...priority, tx: { ...tx, tagNative: true } })).toEqual(['10', '10', '10', 'Sí'])
  })

  it('checks the allowed lists in the sending and receiving direction', () => {
    expect(predict({ ...tag, tx: { ...tag.tx, allowed: [10,99] } })).toEqual(['20', 'Sin salida', '0', 'No'])
    expect(predict({ ...tag, rx: { ...tag.rx, allowed: [10,99] } })).toEqual(['20', '20', '0', 'No'])
  })

  it('decodes all TCI bits and reserves the two exceptional VID values', () => {
    expect(predict(tci)).toEqual(['5', '1', '101', '101'])
    expect(predict({ ...tci, word: 0xa000 })).toEqual(['5', '0', '0', '10'])
    expect(predict({ ...tci, word: 0xffff })).toEqual(['7', '1', '4095', '0'])
  })

  it('applies trust, admission, queuing and drop eligibility separately', () => {
    expect(predict(qos)).toEqual(['5', '3', 'Descartar'])
    expect(predict({ ...qos, trusted: false, congested: false })).toEqual(['1', '1', 'Encolar'])
    expect(predict({ ...qos, classifier: 'dscp', permitted: false })).toEqual(['46', '0', 'Denegar'])
  })

  it('chooses a connected route by destination and detects an earlier L2 or policy failure', () => {
    expect(predict(route)).toEqual(['Entregado', '2', 'G0/1.1', 'G0/1.2'])
    expect(predict({ ...route, topology: 'switch-l3', allowed: null })).toEqual(['Entregado', '0', 'G0/1.1', 'G0/1.2'])
    expect(predict({ ...route, allowed: [16] })).toEqual(['Troncal de origen', '0', 'Sin entrada L3', 'Sin salida L3'])
    expect(predict({ ...route, allowed: [14] })).toEqual(['Troncal de destino', '1', 'G0/1.1', 'G0/1.2'])
    expect(predict({ ...route, permitted: false })).toEqual(['Política', '1', 'G0/1.1', 'G0/1.2'])
    const misplaced = [route.interfaces[0], { ...route.interfaces[1], vlan: 17 }]
    expect(predict({ ...route, interfaces: misplaced })).toEqual(['VLAN de destino incorrecta', '1', 'G0/1.1', 'G0/1.2'])
  })

  it('separates local discovery, relay return and a discovery that never reaches the server', () => {
    expect(predict(relay)).toEqual(['Relay ida y vuelta', '192.0.2.65', '192.0.2.64/26', '192.0.2.65'])
    expect(predict({ ...relay, routeBack: false })).toEqual(['Sin retorno al relay', '192.0.2.65', '192.0.2.64/26', '192.0.2.65'])
    expect(predict({ ...relay, helper: null })).toEqual(['Sin llegada al servidor', 'Sin observación', 'Sin selección', '192.0.2.65'])
    expect(predict({ ...relay, serverVlan: 33, serverAddress: '192.0.2.99', helper: null })).toEqual([
      'Servidor local', '0.0.0.0', '192.0.2.64/26', '192.0.2.65',
    ])
  })

  it('rejects inconsistent profiles and uses the common practice, validator and draft recovery', () => {
    const profile = { cases: [tag, tci, qos, route, relay] }
    expect(validLanVlanProfile(profile)).toBe(true)
    for (const invalid of [
      { ...tag, ingress: { ...tag.ingress, priorityTagged: true } },
      { ...tag, tx: { ...tag.tx, allowed: [10,10] } },
      { ...tag, wireVid: 4096 },
      { ...tci, word: 65536 },
      { ...qos, queues: { '63': 2 } },
      { ...route, allowed: null },
      { ...route, destination: { ...route.destination, address: '192.0.2.16/27' } },
      { ...route, interfaces: [...route.interfaces, { ...route.interfaces[1], vlan: 70, name: 'G0/1.3' }] },
      { ...relay, serverVlan: 33 },
      { ...relay, clientSvi: '192.0.2.64/26' },
    ]) expect(validLanVlanProfile({ cases: [invalid] })).toBe(false)
    const pack = samplePackage()
    pack.activities[0] = { ...pack.activities[0], kind: 'lan-vlan-model', phase: 'practice', profile,
      mode: { kind: 'simulation', version: LAN_VLAN_MODEL_VERSION, engine: 'VLAN', limits: 'Trazas sintéticas' } }
    expect(isPredictionActivity(parsePackage(pack).activities[0])).toBe(true)
    const controls = lanVlanControls(profile)
    const draft = { controls: [tag.label], answers: predict(tag), step: 1 }
    expect(parsePredictionDraft(JSON.stringify(draft), controls, values => describeLanVlan(profile, values))).toEqual(draft)
  })
})
