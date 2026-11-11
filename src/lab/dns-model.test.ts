import { describe, expect, it } from 'vitest'
import { describeDns, dnsControls, DNS_MODEL_VERSION, validDnsProfile, type DnsProfile } from './dns-model'
import { samplePackage } from './fixtures.test-support'
import { isPredictionActivity, matchesPredictionAnswer, parsePredictionDraft } from './prediction'
import { parsePackage } from './validate'

type Case = DnsProfile['cases'][number]
const lookup = {
  kind:'lookup', label:'Zona de prueba', zone:'archive.test.', name:'view.archive.test.', query:'A',
  rows:[
    { owner:'view.archive.test.', type:'CNAME', value:'edge.archive.test.' },
    { owner:'edge.archive.test.', type:'A', value:'192.0.2.33' },
    { owner:'edge.archive.test.', type:'A', value:'192.0.2.41' },
    { owner:'desk.tools.archive.test.', type:'AAAA', value:'2001:db8::33' },
  ],
} satisfies Case
const cut = {
  kind:'delegation', label:'Delegación de prueba', parent:'archive.test.', child:'media.archive.test.',
  server:'ns.media.archive.test.', cut:true, glue:true, knownAddress:false, authoritative:true,
} satisfies Case
const negative = {
  kind:'cache', label:'Caché negativa de prueba', name:'view.archive.test.', query:'AAAA',
  cachedName:'view.archive.test.', cachedType:'A', cached:'NXDOMAIN', ttl:120, soaMinimum:80, elapsed:30,
  current:'RRset solicitado',
} satisfies Case
const exercise = (c: Case) => describeDns({ cases:[c] },[c.label])
const answers = (c: Case) => exercise(c).answers.map(a => a.expected)

describe('finite DNS prediction', () => {
  it('follows aliases for another type and returns CNAME directly when requested', () => {
    expect(answers(lookup)).toEqual(['RRset solicitado','edge.archive.test.','2'])
    expect(answers({ ...lookup, query:'CNAME' })).toEqual(['RRset solicitado','view.archive.test.','1'])
    expect(answers({ ...lookup, query:'AAAA' })).toEqual(['NODATA','edge.archive.test.','0'])
  })

  it('distinguishes an empty non-terminal, a missing name and a finite alias cycle', () => {
    expect(answers({ ...lookup, name:'tools.archive.test.' })).toEqual(['NODATA','tools.archive.test.','0'])
    expect(answers({ ...lookup, name:'missing.archive.test.' })).toEqual(['NXDOMAIN','missing.archive.test.','0'])
    expect(answers({ ...lookup, rows:[lookup.rows[0],{ owner:'edge.archive.test.', type:'CNAME', value:lookup.name }] }))
      .toEqual(['Alias circular','view.archive.test.','0'])
  })

  it('separates a delegation, an address for the named server and its actual authority', () => {
    expect(answers(cut)).toEqual(['Referencia','Glue del padre','RRset solicitado'])
    expect(answers({ ...cut, glue:false })).toEqual(['Referencia','Sin dirección usada','Fallo de resolución'])
    expect(answers({ ...cut, authoritative:false })).toEqual(['Referencia','Glue del padre','Fallo de resolución'])
    expect(answers({ ...cut, cut:false, glue:false })).toEqual(['NXDOMAIN autoritativo','Sin dirección usada','NXDOMAIN'])
    expect(answers({ ...cut, glue:false, knownAddress:true, server:'ns.external.test.' }))
      .toEqual(['Referencia','Dirección obtenida por separado','RRset solicitado'])
  })

  it('reuses negative answers by the correct key and expires them at the shorter SOA TTL', () => {
    expect(answers(negative)).toEqual(['Caché','NXDOMAIN','50'])
    expect(answers({ ...negative, cached:'NODATA' })).toEqual(['Autoridad','RRset solicitado','0'])
    expect(answers({ ...negative, cached:'NODATA', query:'A' })).toEqual(['Caché','NODATA','50'])
    expect(answers({ ...negative, elapsed:80 })).toEqual(['Autoridad','RRset solicitado','0'])
    expect(answers({ ...negative, name:'sub.view.archive.test.' })).toEqual(['Autoridad','RRset solicitado','0'])
  })

  it('uses positive TTL only for the same name and type', () => {
    const { soaMinimum, ...base } = negative
    const positive = { ...base, cached:'RRset solicitado', query:'A', current:'NODATA' } satisfies Case
    expect(answers(positive)).toEqual(['Caché','RRset solicitado','90'])
    expect(answers({ ...positive, query:'AAAA' })).toEqual(['Autoridad','NODATA','0'])
    expect(answers({ ...positive, ttl:0 })).toEqual(['Autoridad','NODATA','0'])
  })

  it('validates bounded symbolic zones, permitted glue and cache entry metadata', () => {
    expect(validDnsProfile({ cases:[lookup,cut,negative] })).toBe(true)
    for (const cases of [
      [lookup,lookup], [{ ...lookup, name:'archive.test.evil.test.' }],
      [{ ...lookup, rows:[...lookup.rows,lookup.rows[0]] }],
      [{ ...lookup, rows:[...lookup.rows,{ owner:lookup.name, type:'A', value:'192.0.2.42' }] }],
      [{ ...lookup, rows:[{ owner:lookup.name, type:'CNAME', value:'outside.test.' }] }],
      [{ ...cut, server:'ns.external.test.' }], [{ ...cut, cut:false }],
      [{ ...negative, elapsed:-1 }], [{ ...negative, soaMinimum:undefined }],
    ]) expect(validDnsProfile({ cases })).toBe(false)
  })

  it('parses a package and preserves a graded prediction and trace position', () => {
    const profile = { cases:[lookup,cut,negative] }
    const pack = samplePackage()
    const activity = {
      ...pack.activities[0], kind:'dns-model' as const, phase:'practice' as const, profile,
      mode:{ kind:'simulation' as const, engine:'DNS', version:DNS_MODEL_VERSION, limits:'Datos sintéticos' },
    }
    pack.activities[0] = activity
    expect(isPredictionActivity(parsePackage(pack).activities[0])).toBe(true)
    expect(() => parsePackage({ ...pack, activities:[{ ...activity, mode:{ ...activity.mode, version:'future' } }] }))
      .toThrow(/perfil DNS inválido/)
    const snapshot = structuredClone(profile)
    const draft = { controls:[negative.label], answers:answers(negative), step:1 }
    expect(parsePredictionDraft(JSON.stringify(draft),dnsControls(profile),values => describeDns(profile,values))).toEqual(draft)
    expect(exercise(negative).answers.every((a,i) => matchesPredictionAnswer(a,draft.answers[i]))).toBe(true)
    expect(profile).toEqual(snapshot)
  })
})
