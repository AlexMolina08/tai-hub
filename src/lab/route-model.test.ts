import { describe, expect, it } from 'vitest'
import { samplePackage } from './fixtures.test-support'
import { isPredictionActivity, parsePredictionDraft } from './prediction'
import { describeRoute, routeControls, ROUTE_MODEL_VERSION, validRouteProfile, type RouteProfile } from './route-model'
import { parsePackage } from './validate'

type Scenario = RouteProfile['scenarios'][number]
const lookup = (destination: string, label = destination): Scenario['queries'][number] =>
  ({ kind: 'lookup', destination, questions: [{ label, field: 'decision' }] })
const sample: RouteProfile = { scenarios: [
  { label: 'Selección por prefijo', routes: [
    { prefix: '0.0.0.0/0', action: 'forward', interface: 'wan', via: '192.0.2.1' },
    { prefix: '192.0.2.0/24', action: 'forward', interface: 'lan' },
    { prefix: '192.0.2.32/27', action: 'discard' },
    { prefix: '192.0.2.40/32', action: 'local' },
    { prefix: '::/0', action: 'forward', interface: 'wan6', via: 'fe80::1' },
    { prefix: '2001:db8::/64', action: 'forward', interface: 'lan6' },
    { prefix: '2001:db8:0:0:8000::/65', action: 'forward', interface: 'exc' },
    { prefix: '::ffff:192.0.2.1/128', action: 'local' },
  ], queries: [
    lookup('192.0.2.31'), lookup('192.0.2.32'), lookup('192.0.2.40'), lookup('198.51.100.1'),
    lookup('2001:db8::7fff:0:0:1'), lookup('2001:db8:0:0:8000::1'), lookup('::FFFF:c000:0201'), lookup('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'),
  ] },
  { label: 'Resolución de vecino', routes: [
    { prefix: '198.51.100.0/24', action: 'forward', via: '203.0.113.3' },
    { prefix: '203.0.113.3/32', action: 'forward', via: '192.0.2.7' },
    { prefix: '192.0.2.0/24', action: 'forward', interface: 'lan' },
    { prefix: '203.0.113.4/32', action: 'forward', via: '203.0.113.5' },
    { prefix: '203.0.113.5/32', action: 'forward', via: '203.0.113.4' },
    { prefix: '203.0.113.6/32', action: 'forward', via: '203.0.113.7' },
  ], queries: [
    { kind: 'lookup', destination: '198.51.100.2', questions: [{ label: 'Vecino efectivo', field: 'neighbor' }, { label: 'Salida', field: 'decision' }] },
    lookup('203.0.113.4'), lookup('203.0.113.6'), lookup('203.0.113.8'),
  ] },
] }

const results = (profile: RouteProfile, label: string) => describeRoute(profile, [label]).answers.map(a => a.expected)

describe('route prediction', () => {
  it('compares numeric IPv4 and IPv6 prefixes, including defaults and host routes', () => {
    expect(validRouteProfile(sample)).toBe(true)
    expect(results(sample, 'Selección por prefijo')).toEqual(['lan', 'Descartar', 'Local', 'wan', 'lan6', 'exc', 'Local', 'wan6'])
  })

  it('distinguishes output, missing resolution, cycles, missing routes and recursion depth', () => {
    const exercise = describeRoute(sample, ['Resolución de vecino'])
    expect(exercise.answers.map(a => a.expected)).toEqual(['192.0.2.7', 'lan', 'Ciclo', 'Sin resolución', 'Sin ruta'])
    expect(exercise.trace?.slice(0, 3)).toEqual([
      '198.51.100.2 → 198.51.100.0/24 → resolver 203.0.113.3.',
      '203.0.113.3 → 203.0.113.3/32 → resolver 192.0.2.7.',
      '192.0.2.7 → 192.0.2.0/24 → salida lan, vecino 192.0.2.7.',
    ])
    const long = structuredClone(sample)
    long.scenarios[1].routes = [
      ...Array.from({ length: 9 }, (_, i) => ({ prefix: `192.0.2.${i}/32`, action: 'forward' as const, via: `192.0.2.${i + 1}` })),
      { prefix: '192.0.2.9/32', action: 'forward', interface: 'lan' },
    ]
    long.scenarios[1].queries = [lookup('192.0.2.0')]
    expect(validRouteProfile(long)).toBe(true)
    expect(results(long, 'Resolución de vecino')).toEqual(['Límite de recursión'])
  })

  it('excludes unusable candidates, compares metrics only within a source and reports ties', () => {
    const profile = structuredClone(sample)
    const prefix = '198.51.100.0/24'
    profile.scenarios[1] = { label: 'Candidatas', routes: [], candidates: { policy: 'cisco-ad', entries: [
      { prefix, source: 'ospf', distance: 110, metric: 20, via: 'OSPF1', resolved: true },
      { prefix, source: 'ospf', distance: 110, metric: 10, via: 'OSPF2', resolved: true },
      { prefix, source: 'rip', distance: 120, metric: 3, via: 'RIP1', resolved: true },
      { prefix, source: 'rip', distance: 120, metric: 16, via: 'RIP2', resolved: true },
      { prefix, source: 'static', distance: 1, metric: 0, via: 'Estatica1', resolved: false },
      { prefix, source: 'connected', distance: 255, metric: 0, via: 'Conectada1', resolved: true },
    ] },
    queries: [
      { kind: 'selection', prefix, question: { label: 'Primera', field: 'via' } },
      { kind: 'selection', prefix, without: ['ospf'], question: { label: 'Segunda', field: 'via' } },
      { kind: 'selection', prefix, without: ['ospf', 'rip'], question: { label: 'Tercera', field: 'installed' } },
    ] }
    expect(validRouteProfile(profile)).toBe(true)
    expect(results(profile, 'Candidatas')).toEqual(['OSPF2', 'RIP1', 'No instalada'])
    profile.scenarios[1].candidates!.entries[0].metric = 10
    expect(results(profile, 'Candidatas')).toEqual(['Empate', 'RIP1', 'No instalada'])
  })

  it('rejects malformed prefixes, duplicate aliases and cross-family next hops', () => {
    for (const prefix of ['192.0.2.1/24', '192.0.2.0/33', '2001:db8::1/64', '2001:db8::/129', '2001:::db8/128', '::ffff: 192.0.2.1/128']) {
      const broken = structuredClone(sample)
      broken.scenarios[0].routes[0].prefix = prefix
      expect(validRouteProfile(broken)).toBe(false)
    }
    const broken = structuredClone(sample)
    broken.scenarios[0].routes.push({ prefix: '0000:0000:0000:0000:0000:ffff:c000:201/128', action: 'discard' })
    expect(validRouteProfile(broken)).toBe(false)
    broken.scenarios[0].routes.pop()
    broken.scenarios[0].routes.push({ prefix: '2001:db8:7::/64', action: 'forward', via: '192.0.2.1' })
    expect(validRouteProfile(broken)).toBe(false)
  })

  it('admits the activity through the package validator and recovers drafts without a stale trace index', () => {
    const pack = samplePackage()
    const first = pack.activities[0]
    pack.activities[0] = { ...first, kind: 'route-model', phase: 'practice', profile: sample,
      mode: { kind: 'simulation', version: ROUTE_MODEL_VERSION, engine: 'routes', limits: 'Synthetic data' } }
    expect(isPredictionActivity(parsePackage(pack).activities[0])).toBe(true)
    expect(() => parsePackage({ ...pack, activities: [{ ...pack.activities[0], phase: 'reserved' }, ...pack.activities.slice(1)] }, 'authoring'))
      .toThrow('perfil de rutas inválido')
    const controls = routeControls(sample)
    const deserialize = (value: unknown) => parsePredictionDraft(JSON.stringify(value), controls, values => describeRoute(sample, values))
    const draft = { controls: ['Resolución de vecino'], answers: ['192.0.2.7', 'lan', 'Ciclo', 'Sin resolución', 'Sin ruta'], step: 2 }
    expect(deserialize(draft)).toEqual(draft)
    expect(deserialize({ ...draft, step: 99 }).step).toBeUndefined()
    expect(deserialize({ ...draft, controls: ['No existe'] }).answers).toEqual(Array(8).fill(''))
  })
})
