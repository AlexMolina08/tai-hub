import { describe, expect, it } from 'vitest'
import { samplePackage } from './fixtures.test-support'
import { describeNat, natControls, NAT_MODEL_VERSION, validNatProfile, type NatProfile } from './nat-model'
import { isPredictionActivity, matchesPredictionAnswer, parsePredictionDraft } from './prediction'
import { parsePackage } from './validate'

type Case = NatProfile['cases'][number]
const ip = (address: string, port: number) => ({ address, port })
const internal = ip('10.0.0.9',1234)
const external = ip('198.51.100.41',42000)
const remote = ip('203.0.113.7',5400)
const other = ip('203.0.113.7',5500)
const packet = { protocol:'UDP' as const, source:internal, destination:remote }
const association = { protocol:'UDP' as const, inside:internal, outside:external, peers:[remote] }
const basic = {
  kind:'address', label:'NAT de prueba', packet, allocation:'dynamic', pool:['198.51.100.40','198.51.100.41'],
  bindings:[{ inside:'10.0.0.8', outside:'198.51.100.40' }],
} satisfies Case
const pat = {
  kind:'pat', label:'Puertos de prueba', direction:'outbound', packet, external:external.address,
  ports:[42000,42001], bindings:[association], filtering:'listed',
} satisfies Case
const outside = ip('192.0.2.100',4500)
const shared = ip('100.64.1.4',41000)
const path = {
  kind:'path', label:'Dos etapas de prueba', direction:'outbound', packet,
  stages:[{ ...association, outside:shared },{ ...association, inside:shared, outside }],
} satisfies Case
const service = ip('10.0.0.2',8443)
const fallback = ip('10.0.0.3',443)
const pub = {
  kind:'publish', label:'Publicación de prueba', ingress:'servicio',
  packet:{ ...packet, protocol:'TCP', destination:ip('198.51.100.80',443) },
  rules:[
    { id:'especifica', ingress:'servicio', protocol:'TCP', address:'198.51.100.80', port:443, destination:service },
    { id:'general', ingress:'servicio', protocol:'TCP', address:'198.51.100.80', destination:fallback },
  ],
  permitted:[service],
} satisfies Case
const explain = (item: Case) => describeNat({ cases:[item] },[item.label])
const answers = (item: Case) => explain(item).answers.map(a => a.expected)

describe('finite NAT prediction', () => {
  it('allocates an address in pool order without translating transport ports', () => {
    expect(answers(basic)).toEqual(['Nueva','198.51.100.41','1234'])
    expect(answers({ ...basic, packet:{ ...packet, source:ip('10.0.0.8',5555) } }))
      .toEqual(['Existente','198.51.100.40','5555'])
    expect(answers({ ...basic, pool:['198.51.100.40'] })).toEqual(['Sin asociación','Sin salida','0'])
    expect(answers({ ...basic, allocation:'static', pool:[] })).toEqual(['Sin asociación','Sin salida','0'])
  })

  it('reuses a PAT binding on destination changes and separates transport namespaces', () => {
    expect(answers({ ...pat, packet:{ ...packet, destination:other } })).toEqual(['Existente',external.address,'42000'])
    const newSender = { ...packet, source:ip('10.0.0.3',1234) }
    expect(answers({ ...pat, packet:newSender })).toEqual(['Nueva',external.address,'42001'])
    expect(answers({ ...pat, packet:newSender, ports:[42000] })).toEqual(['Sin asociación','Sin salida','0'])
    expect(answers({ ...pat, packet:{ ...newSender, protocol:'TCP' } })).toEqual(['Nueva',external.address,'42000'])
    expect(answers({ ...pat, bindings:[], ports:[65535] })).toEqual(['Nueva',external.address,'65535'])
  })

  it('looks up return by protocol and public endpoint and then applies the separate filter', () => {
    const inbound = { ...pat, direction:'inbound' as const, packet:{ ...packet, source:remote, destination:external } }
    expect(answers(inbound)).toEqual(['Existente',internal.address,'1234'])
    expect(answers({ ...inbound, packet:{ ...inbound.packet, source:other } })).toEqual(['Filtrado por origen','Sin salida','0'])
    expect(answers({ ...inbound, filtering:'any', packet:{ ...inbound.packet, source:other } }))
      .toEqual(['Existente',internal.address,'1234'])
    expect(answers({ ...inbound, packet:{ ...inbound.packet, protocol:'TCP' } })).toEqual(['Sin asociación','Sin salida','0'])
    expect(answers({ ...inbound, packet:{ ...inbound.packet, destination:ip('198.51.100.60',42000) } }))
      .toEqual(['Sin asociación','Sin salida','0'])
  })

  it('applies two translations in the proper order and stops if a binding is missing', () => {
    expect(answers(path)).toEqual([shared.address,'41000',outside.address,'4500'])
    const reply = { ...path, direction:'inbound' as const, packet:{ ...packet, source:remote, destination:outside } }
    expect(answers(reply)).toEqual([shared.address,'41000',internal.address,'1234'])
    const mismatch = { ...path, stages:[path.stages[0],{ ...path.stages[1], inside:ip(shared.address,41001) }] } satisfies Case
    expect(answers(mismatch)).toEqual([shared.address,'41000','Sin salida','0'])
  })

  it('uses the first matching publication rule and does not equate translation with permission', () => {
    expect(answers(pub)).toEqual(['especifica',service.address,'8443','Admitida'])
    expect(answers({ ...pub, rules:[pub.rules[1],pub.rules[0]] })).toEqual(['general',fallback.address,'443','No admitida'])
    expect(answers({ ...pub, ingress:'gestion' })).toEqual(['Sin regla','Sin salida','0','Sin publicación'])
    expect(answers({ ...pub, packet:{ ...pub.packet, protocol:'UDP' } })).toEqual(['Sin regla','Sin salida','0','Sin publicación'])
  })

  it('rejects ambiguous tables, invalid endpoints and duplicate case or rule identifiers', () => {
    expect(validNatProfile({ cases:[basic,pat,path,pub] })).toBe(true)
    for (const cases of [
      [basic,basic],
      [{ ...basic, pool:['256.0.0.1'] }],
      [{ ...basic, pool:['198.51.100.41'] }],
      [{ ...pat, bindings:[association,association] }],
      [{ ...pat, bindings:[{ ...association, outside:ip('192.0.2.4',42000) }] }],
      [{ ...pat, ports:[0] }],
      [{ ...pub, rules:[pub.rules[0],pub.rules[0]] }],
      [{ ...path, stages:[path.stages[0]] }],
    ]) expect(validNatProfile({ cases })).toBe(false)
  })

  it('validates the package and saves predictions and trace without mutating the profile', () => {
    const profile = { cases:[basic,pat,path,pub] }
    const pack = samplePackage()
    const activity = {
      ...pack.activities[0], kind:'nat-model' as const, phase:'practice' as const, profile,
      mode:{ kind:'simulation' as const, version:NAT_MODEL_VERSION, engine:'NAT', limits:'Datos sintéticos' },
    }
    pack.activities[0] = activity
    expect(isPredictionActivity(parsePackage(pack).activities[0])).toBe(true)
    expect(() => parsePackage({ ...pack, activities:[{ ...activity, mode:{ ...activity.mode, version:'future' } }] }))
      .toThrow(/perfil NAT inválido/)
    const snapshot = structuredClone(profile)
    const draft = { controls:[path.label], answers:answers(path), step:2 }
    const describe = (values: string[]) => describeNat(profile,values)
    expect(parsePredictionDraft(JSON.stringify(draft),natControls(profile),describe)).toEqual(draft)
    expect(describe([path.label]).answers.every((a,i) => matchesPredictionAnswer(a,draft.answers[i]))).toBe(true)
    expect(profile).toEqual(snapshot)
  })
})
