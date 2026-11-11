import { describe, expect, it } from 'vitest'
import { samplePackage } from './fixtures.test-support'
import {
  describeLanRedundancy, lanRedundancyControls, LAN_REDUNDANCY_MODEL_VERSION, validLanRedundancyProfile,
  type LanRedundancyProfile,
} from './lan-redundancy-model'
import { isPredictionActivity, matchesPredictionAnswer, parsePredictionDraft } from './prediction'
import { parsePackage } from './validate'

type Case = LanRedundancyProfile['cases'][number]
const bridge = (name: string, priority: number, suffix: string) => ({ name, priority, mac: '02:00:00:00:00:' + suffix })
const port = (node: string, number: number, priority = 128) => ({ node, number, priority })
const link = (name: string, a: ReturnType<typeof port>, b: ReturnType<typeof port>, cost: number) => ({ name, a, b, cost, up: true })

const tree = {
  kind: 'tree', label: 'Red con camino alternativo', mode: 'rapid', instance: 13, observer: 'C', observedLink: 'BC',
  nodes: [bridge('A',8192,'0a'),bridge('B',8192,'0b'),bridge('C',16384,'0c')],
  links: [link('AB',port('A',1),port('B',1),5),link('AC',port('A',2),port('C',1),6),link('BC',port('B',2),port('C',2),7)],
} satisfies Case
const bpdu = {
  kind: 'bpdu', label: 'Registro de región', version: 3, cost: 4, localCost: null, root: 'A', sender: 'B',
  localRegion: { name:'TALLER', revision:2, mapping:{ '11':1, '12':2 } },
  remoteRegion: { name:'TALLER', revision:2, mapping:{ '12':2, '11':1 } },
} satisfies Case
const guard = {
  kind: 'guard', label:'Registro de protección', edge:false, policy:'loop-guard', event:'lost', role:'alternate', scope:'interface',
} satisfies Case
const member = (port: number) => ({ port, rateMbps:1000, up:true, fullDuplex:true, settingsMatch:true, peerReady:true })
const lag = {
  kind:'lag', label:'Dos miembros de 1 Gbit/s', leftMode:'active', rightMode:'passive', rateMbps:1000,
  minLinks:1, members:[member(3),member(1)], flows:[0,1,2],
} satisfies Case
const counters = {
  kind:'counter', label:'Lecturas sincronizadas', seconds:4, rateMbps:100, duplex:['half','full'],
  start:{ rxBytes:1, txBytes:2, crc:8, late:4, drops:7 },
  end:{ rxBytes:5_000_001, txBytes:10_000_002, crc:13, late:7, drops:7 },
  captureA:97, captureB:103, comparable:true,
} satisfies Case

const explain = (item: Case) => describeLanRedundancy({ cases:[item] },[item.label])
const answers = (item: Case) => explain(item).answers.map(a => a.expected)

describe('LAN redundancy prediction', () => {
  it('chooses the bridge by priority then MAC and recalculates costs and roles after failure', () => {
    expect(answers(tree)).toEqual(['A','6','1','Alternativo · Descartando'])
    expect(answers({ ...tree, mode:'classic' })).toEqual(['A','6','1','No designado · Bloqueo'])
    const links = tree.links.map(item => ({ ...item, up:item.name !== 'AC' }))
    expect(answers({ ...tree, links })).toEqual(['A','12','2','Raíz · Reenvío'])
    expect(answers({ ...tree, links, observedLink:'AC' })).toEqual(['A','12','2','Deshabilitado'])
  })

  it('uses the sender port ID on equal-cost point-to-point links', () => {
    const sample = { ...tree, nodes:tree.nodes.slice(0,2), observer:'B', observedLink:'AB',
      links:[link('AB',port('A',1,128),port('B',2),7),link('AB2',port('A',2,112),port('B',3),7)] }
    expect(validLanRedundancyProfile({ cases:[sample] })).toBe(true)
    expect(answers(sample)).toEqual(['A','7','3','Alternativo · Descartando'])
  })

  it('uses the BPDU version and compares MST configuration independently of map order', () => {
    expect(answers(bpdu)).toEqual(['MSTP','No','Misma región'])
    expect(answers({ ...bpdu, remoteRegion:{ ...bpdu.remoteRegion, revision:3 } })).toEqual(['MSTP','No','Región distinta'])
    expect(answers({ ...bpdu, version:0, localCost:4, localRegion:null, remoteRegion:null })).toEqual(['STP clásico','No','8','No aplica'])
  })

  it('distinguishes edge forwarding, BPDU guard, root guard and loop guard', () => {
    expect(answers(guard)).toEqual(['Loop-inconsistent','No'])
    expect(answers({ ...guard, edge:true, policy:'none', event:'none', role:'designated' })).toEqual(['Reenvío de borde','Sí'])
    expect(answers({ ...guard, edge:true, policy:'bpdu-guard', scope:'global-edge', event:'arrival' })).toEqual(['Error-disabled','No'])
    expect(answers({ ...guard, policy:'root-guard', event:'superior', role:'designated' })).toEqual(['Root-inconsistent','No'])
  })

  it('compares negotiation, member compatibility, aggregate threshold and stable flow assignment', () => {
    expect(answers(lag)).toEqual(['LACP','2','Activo','2000','1000','1,3,1'])
    expect(answers({ ...lag, leftMode:'passive' })).toEqual(['Sin agregado común','0','Inactivo','0','0','-'])
    const members = [member(1),{ ...member(3), settingsMatch:false }]
    expect(answers({ ...lag, members })).toEqual(['LACP','1','Activo','1000','1000','1,1,1'])
    expect(answers({ ...lag, members, minLinks:2 })).toEqual(['LACP','1','Inactivo','0','0','-'])
  })

  it('takes interval differences and checks capture comparability before subtracting', () => {
    const exercise = explain(counters)
    expect(exercise.answers.map(a => a.expected)).toEqual(['10','20','5','3','0','Sí','-6'])
    expect(matchesPredictionAnswer(exercise.answers[6],'-6')).toBe(true)
    expect(answers({ ...counters, comparable:false })).toEqual(['10','20','5','3','0','Sí','-'])
  })

  it('rejects contradictory data and persists a standard prediction draft', () => {
    const profile = { cases:[tree,bpdu,guard,lag,counters] }
    expect(validLanRedundancyProfile(profile)).toBe(true)
    for (const invalid of [
      { ...tree, links:tree.links.map(item => ({ ...item, up:item.name === 'AB' })) },
      { ...tree, nodes:tree.nodes.map(n => ({ ...n, priority:123 })) },
      { ...bpdu, localCost:2 },
      { ...guard, scope:'global-edge' },
      { ...lag, members:[member(1),member(1)] },
      { ...lag, minLinks:3 },
      { ...counters, end:{ ...counters.end, crc:2 } },
      { ...counters, captureA:null },
    ]) expect(validLanRedundancyProfile({ cases:[invalid] })).toBe(false)
    const pack = samplePackage()
    pack.activities[0] = { ...pack.activities[0], kind:'lan-redundancy-model', phase:'practice', profile,
      mode:{ kind:'simulation', version:LAN_REDUNDANCY_MODEL_VERSION, engine:'Redundancia LAN', limits:'Trazas sintéticas' } }
    expect(isPredictionActivity(parsePackage(pack).activities[0])).toBe(true)
    const schema = lanRedundancyControls(profile)
    const draft = { controls:[tree.label], answers:answers(tree), step:2 }
    expect(parsePredictionDraft(JSON.stringify(draft),schema,values => describeLanRedundancy(profile,values))).toEqual(draft)
  })
})
