import { validateInput } from './ipv4'
import type { PredictionControl, PredictionExercise } from './prediction'

export const ROUTE_MODEL_VERSION = 'route-model-v1'

type Address = { bits: bigint; width: 32 | 128; text: string }
type Prefix = { address: Address; length: number }
type Route =
  | { prefix: string; action: 'local' | 'discard' }
  | { prefix: string; action: 'forward'; interface: string; via?: string }
  | { prefix: string; action: 'forward'; interface?: never; via: string }

const protocols = ['connected', 'static', 'ospf', 'rip'] as const
type Protocol = typeof protocols[number]
type Candidate = { prefix: string; source: Protocol; distance: number; metric: number; via: string; resolved: boolean }
type ForwardQuestion = { label: string; field: 'decision' | 'neighbor' }
type Query =
  | { kind: 'lookup'; destination: string; questions: ForwardQuestion[] }
  | { kind: 'selection'; prefix: string; without?: Protocol[]; question: { label: string; field: 'via' | 'installed' } }
type Scenario = {
  label: string
  routes: Route[]
  candidates?: { policy: 'cisco-ad'; entries: Candidate[] }
  queries: Query[]
}
export type RouteProfile = { scenarios: Scenario[] }

const noRoute = 'Sin ruta'
const noResolution = 'Sin resolución'
const recursionCycle = 'Ciclo'
const recursionLimit = 'Límite de recursión'
const local = 'Local'
const discard = 'Descartar'
const noNeighbor = 'Sin vecino'
const installed = 'Instalada'
const notInstalled = 'No instalada'
const tie = 'Empate'
const terminalDecisions = [noRoute, noResolution, recursionCycle, recursionLimit, local, discard]
const maxLookups = 8
const sourceNames: Record<Protocol, string> = { connected: 'conectada', static: 'estática', ospf: 'OSPF', rip: 'RIP' }

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const label = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 80 && value.trim() === value && !/[\r\n]/.test(value)
const portName = (value: unknown): value is string => typeof value === 'string'
  && /^[a-zA-Z0-9][a-zA-Z0-9/_.:-]{0,19}$/.test(value) && !terminalDecisions.includes(value)
const protocol = (value: unknown): value is Protocol => typeof value === 'string' && protocols.some(p => p === value)
const int = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max

function ipv4Number(text: string): number | undefined {
  const parsed = validateInput({ address: text, format: 'prefix', value: '32', probe: '', context: 'numeric' })
  return parsed.ok ? parsed.input.addressNumber : undefined
}

function parseAddress(raw: unknown): Address | undefined {
  if (typeof raw !== 'string' || raw.length > 45 || /\s/.test(raw)) return
  if (!raw.includes(':')) {
    const bits = ipv4Number(raw)
    if (bits !== undefined) return { bits: BigInt(bits), width: 32, text: raw }
    return
  }
  let text = raw.toLowerCase()
  if (text.includes('.')) {
    const colon = text.lastIndexOf(':')
    const tail = ipv4Number(text.slice(colon + 1))
    if (tail === undefined) return
    text = text.slice(0, colon + 1) + Math.floor(tail / 65536).toString(16) + ':' + (tail % 65536).toString(16)
  }
  const halves = text.split('::')
  if (halves.length > 2) return
  const [left, right] = halves.map(part => part === '' ? [] : part.split(':'))
  const groups = [...left, ...(right ?? [])]
  const missing = 8 - groups.length
  if (right ? missing < 1 : missing !== 0) return
  if (!groups.every(group => /^[0-9a-f]{1,4}$/.test(group))) return
  const words = [...left, ...Array<string>(missing).fill('0'), ...(right ?? [])].map(group => parseInt(group, 16))
  const bits = words.reduce((value, word) => (value << 16n) + BigInt(word), 0n)
  return { bits, width: 128, text: ipv6Text(words) }
}

function ipv6Text(words: number[]): string {
  let longest = 1, start = 0, run = 0
  for (let i = 0; i < words.length; i++) {
    run = words[i] === 0 ? run + 1 : 0
    if (run > longest) { longest = run; start = i + 1 - run }
  }
  const groups = words.map(word => word.toString(16))
  return longest > 1 ? groups.slice(0, start).join(':') + '::' + groups.slice(start + longest).join(':') : groups.join(':')
}

function parsePrefix(raw: unknown): Prefix | undefined {
  if (typeof raw !== 'string' || raw.length > 49) return
  const [text, lengthText, extra] = raw.split('/')
  if (extra !== undefined || !/^(0|[1-9]\d{0,2})$/.test(lengthText)) return
  const address = parseAddress(text)
  const length = Number(lengthText)
  if (!address || length > address.width) return
  const shift = BigInt(address.width - length)
  if ((address.bits >> shift) << shift === address.bits) return { address, length }
}

const prefixKey = ({ address, length }: Prefix) => `${address.width}:${address.bits}/${length}`

function validRoute(raw: unknown): raw is Route {
  if (!record(raw)) return false
  const prefix = parsePrefix(raw.prefix)
  if (!prefix) return false
  if (raw.action === 'local' || raw.action === 'discard') {
    return raw.interface === undefined && raw.via === undefined
  }
  if (raw.action !== 'forward' || (raw.interface !== undefined && !portName(raw.interface))) return false
  if (raw.via === undefined) return raw.interface !== undefined
  return parseAddress(raw.via)?.width === prefix.address.width
}

function validCandidate(raw: unknown): raw is Candidate {
  if (!record(raw) || !protocol(raw.source) || !int(raw.distance, 255) || !int(raw.metric, 2 ** 32 - 1)
    || typeof raw.resolved !== 'boolean' || typeof raw.via !== 'string') return false
  if (raw.source === 'rip' && (raw.metric < 1 || raw.metric > 16)) return false
  const prefix = parsePrefix(raw.prefix)
  if (!prefix) return false
  const via = parseAddress(raw.via)
  return via ? via.width === prefix.address.width
    : /^[a-zA-Z][a-zA-Z0-9_-]{0,19}$/.test(raw.via) && raw.via !== installed && raw.via !== tie
}

function validQuery(raw: unknown): raw is Query {
  if (!record(raw)) return false
  if (raw.kind === 'lookup') {
    return !!parseAddress(raw.destination) && Array.isArray(raw.questions)
      && raw.questions.length >= 1 && raw.questions.length <= 2
      && raw.questions.every(q => record(q) && label(q.label) && (q.field === 'decision' || q.field === 'neighbor'))
      && new Set(raw.questions.map(q => q.field)).size === raw.questions.length
  }
  return raw.kind === 'selection' && !!parsePrefix(raw.prefix) && record(raw.question) && label(raw.question.label)
    && (raw.question.field === 'via' || raw.question.field === 'installed')
    && (raw.without === undefined || Array.isArray(raw.without) && raw.without.length <= protocols.length
      && raw.without.every(protocol) && new Set(raw.without).size === raw.without.length)
}

function validScenario(raw: unknown): raw is Scenario {
  if (!record(raw) || !label(raw.label) || !Array.isArray(raw.routes) || raw.routes.length > 24
    || !raw.routes.every(validRoute) || !Array.isArray(raw.queries) || raw.queries.length < 1
    || raw.queries.length > 8 || !raw.queries.every(validQuery)) return false
  const routes = raw.routes.map(route => prefixKey(parsePrefix(route.prefix)!))
  if (new Set(routes).size !== routes.length) return false
  const labels = raw.queries.flatMap(query => query.kind === 'lookup' ? query.questions.map(q => q.label) : [query.question.label])
  if (new Set(labels).size !== labels.length) return false
  const selections = raw.queries.filter(query => query.kind === 'selection')
  if (raw.candidates === undefined) return selections.length === 0
  if (!record(raw.candidates) || raw.candidates.policy !== 'cisco-ad'
    || !Array.isArray(raw.candidates.entries) || raw.candidates.entries.length < 1
    || raw.candidates.entries.length > 24 || !raw.candidates.entries.every(validCandidate)) return false
  const distances = new Map<string, number>()
  const prefixes = new Set<string>()
  for (const entry of raw.candidates.entries) {
    const key = prefixKey(parsePrefix(entry.prefix)!)
    prefixes.add(key)
    const sourceKey = key + ':' + entry.source
    if (distances.has(sourceKey) && distances.get(sourceKey) !== entry.distance) return false
    distances.set(sourceKey, entry.distance)
  }
  return selections.every(query => prefixes.has(prefixKey(parsePrefix(query.prefix)!)))
}

export function validRouteProfile(raw: unknown): raw is RouteProfile {
  return record(raw) && Array.isArray(raw.scenarios) && raw.scenarios.length >= 2 && raw.scenarios.length <= 12
    && raw.scenarios.every(validScenario) && new Set(raw.scenarios.map(s => s.label)).size === raw.scenarios.length
}

export function routeControls(profile: RouteProfile): PredictionControl[] {
  const options = profile.scenarios.map(s => s.label)
  return [{ label: 'Caso de encaminamiento', options, initial: options[0] }]
}

type Lookup = { decision: string; neighbor?: string; trace: string[] }

function lookup(table: { route: Route; prefix: Prefix }[], target: string): Lookup {
  let address = parseAddress(target)!
  const trace: string[] = []
  const seen = new Set<bigint>()
  const stop = (decision: string): Lookup => ({ decision, trace: [...trace, `${address.text} → ${decision}.`] })
  for (let step = 0; step < maxLookups; step++) {
    if (seen.has(address.bits)) return stop(recursionCycle)
    seen.add(address.bits)
    // The table is sorted by prefix length. Numeric comparison avoids textual IPv6 aliasing.
    const match = table.find(({ prefix }) => {
      if (prefix.address.width !== address.width) return false
      const shift = BigInt(address.width - prefix.length)
      return address.bits >> shift === prefix.address.bits >> shift
    })
    if (!match) return stop(step === 0 ? noRoute : noResolution)
    const { route } = match
    const prefix = `${address.text} → ${route.prefix}`
    if (route.action !== 'forward') {
      const decision = step === 0 ? route.action === 'local' ? local : discard : noResolution
      return { decision, trace: [...trace, `${prefix} → ${decision}.`] }
    }
    const neighbor = route.via ? parseAddress(route.via)! : address
    if (route.interface) return { decision: route.interface, neighbor: neighbor.text,
      trace: [...trace, `${prefix} → salida ${route.interface}, vecino ${neighbor.text}.`] }
    trace.push(`${prefix} → resolver ${neighbor.text}.`)
    address = neighbor
  }
  return stop(recursionLimit)
}

function selection(entries: Candidate[], without: Protocol[]) {
  const eligible = entries.filter(row => row.resolved && !without.includes(row.source) && row.distance < 255
    && (row.source !== 'rip' || row.metric < 16))
  const proposals = eligible.filter(row => !eligible.some(other => other.source === row.source && other.metric < row.metric))
  const distance = Math.min(...proposals.map(row => row.distance))
  const best = proposals.filter(row => row.distance === distance)
  const sources = new Set(best.map(row => row.source))
  const nextHops = new Set(best.map(row => parseAddress(row.via)?.text ?? row.via))
  const detail = proposals.map(row => `${sourceNames[row.source]} [${row.distance}/${row.metric}] vía ${row.via}`).join(' · ')
  if (sources.size > 1 || nextHops.size > 1) return { state: tie, via: tie, detail }
  if (!best.length) return { state: notInstalled, via: noNeighbor, detail }
  return { state: installed, via: [...nextHops][0], detail }
}

const unique = (values: string[]) => [...new Set(values)]

export function describeRoute(profile: RouteProfile, values: string[]): PredictionExercise {
  const scenario = profile.scenarios.find(s => s.label === values[0]) ?? profile.scenarios[0]
  const table = scenario.routes.map(route => ({ route, prefix: parsePrefix(route.prefix)! })).sort((a, b) => b.prefix.length - a.prefix.length)
  const interfaces = scenario.routes.flatMap(route => route.action === 'forward' && route.interface ? [route.interface] : [])
  const gateways = scenario.routes.flatMap(route => route.action === 'forward' && route.via ? [parseAddress(route.via)!.text] : [])
  const entries = scenario.candidates?.entries ?? []
  const facts = [
    ...scenario.routes.map(route => {
      if (route.action !== 'forward') return `Instalada ${route.prefix} · ${route.action === 'local' ? local : discard}.`
      const via = route.via ? `vía ${route.via}` : 'directa'
      return `Instalada ${route.prefix} · ${via}${route.interface ? ` por ${route.interface}` : ''}.`
    }),
    ...entries.map(row => `Candidata ${row.prefix} · ${sourceNames[row.source]} [${row.distance}/${row.metric}] vía ${row.via} · ${row.resolved ? 'resoluble' : 'sin resolución'}.`),
  ]
  if (scenario.candidates) facts.push('Selección Cisco sintética: métrica dentro de cada fuente y distancia administrativa entre fuentes del mismo prefijo.')
  const trace: string[] = []
  const exercise: PredictionExercise = { facts, answers: [], steps: [], trace }
  for (const query of scenario.queries) {
    if (query.kind === 'lookup') {
      facts.push(`Destino a consultar: ${query.destination}.`)
      const result = lookup(table, query.destination)
      for (const question of query.questions) {
        const expected = question.field === 'decision' ? result.decision : result.neighbor ?? noNeighbor
        const options = question.field === 'decision' ? [...interfaces, ...terminalDecisions]
          : [...gateways, parseAddress(query.destination)!.text, noNeighbor]
        exercise.answers.push({ label: question.label, expected, options: unique([...options, expected]) })
      }
      trace.push(...result.trace)
      continue
    }
    const without = query.without ?? []
    const excluded = without.map(source => sourceNames[source]).join(', ')
    facts.push(`${query.question.label} · ${query.prefix}${excluded ? ` tras retirar ${excluded}` : ' con las candidatas indicadas'}.`)
    const matching = entries.filter(row => prefixKey(parsePrefix(row.prefix)!) === prefixKey(parsePrefix(query.prefix)!))
    const { state, via, detail } = selection(matching, without)
    const expected = query.question.field === 'via' ? via : state
    const options = query.question.field === 'via' ? [...matching.map(row => parseAddress(row.via)?.text ?? row.via), noNeighbor, tie]
      : [installed, notInstalled, tie]
    exercise.answers.push({ label: query.question.label, expected, options: unique(options) })
    const summary = detail ? `Propuestas elegibles: ${detail}.` : 'Sin propuestas elegibles.'
    trace.push(`${query.prefix}${excluded ? ` sin ${excluded}` : ''} · ${summary} Resultado: ${state}${state === installed ? ` vía ${via}` : ''}.`)
  }
  if (scenario.routes.length) exercise.steps.push('La búsqueda compara prefijos de la misma familia y aplica la entrada instalada más específica.')
  if (scenario.candidates) exercise.steps.push('Solo compiten candidatas resolubles y elegibles. Una igualdad sin selección única queda como empate.')
  return exercise
}
