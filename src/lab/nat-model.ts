import { validateInput } from './ipv4'
import type { PredictionAnswer, PredictionControl, PredictionExercise } from './prediction'

export const NAT_MODEL_VERSION = 'nat-model-v1'

type Protocol = 'TCP' | 'UDP'
type Direction = 'outbound' | 'inbound'
type Endpoint = { address: string; port: number }
type Packet = { protocol: Protocol; source: Endpoint; destination: Endpoint }
type AddressBinding = { inside: string; outside: string }
type Binding = { protocol: Protocol; inside: Endpoint; outside: Endpoint; peers: Endpoint[] }
type Rule = { id: string; ingress?: string; protocol?: Protocol; address?: string; port?: number; destination: Endpoint }

type AddressCase = {
  kind: 'address'; label: string; packet: Packet
  allocation: 'static' | 'dynamic'; bindings: AddressBinding[]; pool: string[]
}
type PortCase = {
  kind: 'pat'; label: string; packet: Packet; direction: Direction
  external: string; ports: number[]; bindings: Binding[]; filtering: 'any' | 'listed'
}
type PathCase = {
  kind: 'path'; label: string; packet: Packet; direction: Direction
  stages: [Binding, Binding]
}
type PublishCase = {
  kind: 'publish'; label: string; packet: Packet; ingress: string
  rules: Rule[]; permitted: Endpoint[]
}

type NatCase = AddressCase | PortCase | PathCase | PublishCase
export type NatProfile = { cases: NatCase[] }

const absent = 'Sin salida'
const noRule = 'Sin regla'
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const label = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 80
  && v === v.trim() && !/[\r\n]/.test(v)
const name = (v: unknown): v is string => label(v) && /^[a-z0-9][a-z0-9_.-]{0,19}$/i.test(v)
const port = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535
const protocol = (v: unknown): v is Protocol => v === 'TCP' || v === 'UDP'
const direction = (v: unknown): v is Direction => v === 'outbound' || v === 'inbound'

function address(v: unknown): v is string {
  return typeof v === 'string' && /^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(v)
    && validateInput({ address:v, format:'prefix', value:'32', probe:'', context:'numeric' }).ok
}

const endpoint = (v: unknown): v is Endpoint => record(v) && address(v.address) && port(v.port)
const packet = (v: unknown): v is Packet => record(v) && protocol(v.protocol) && endpoint(v.source) && endpoint(v.destination)
const unique = <T>(values: readonly T[]) => new Set(values).size === values.length
const endpointText = (v: Endpoint) => `${v.address}:${v.port}`
const sameEndpoint = (a: Endpoint, b: Endpoint) => a.address === b.address && a.port === b.port
const addressBinding = (v: unknown): v is AddressBinding => record(v) && address(v.inside) && address(v.outside)
const binding = (v: unknown): v is Binding => record(v) && protocol(v.protocol) && endpoint(v.inside) && endpoint(v.outside)
  && Array.isArray(v.peers) && v.peers.length <= 8 && v.peers.every(endpoint) && unique(v.peers.map(endpointText))

function validRule(v: unknown): v is Rule {
  return record(v) && name(v.id) && endpoint(v.destination)
    && (v.ingress === undefined || name(v.ingress)) && (v.protocol === undefined || protocol(v.protocol))
    && (v.address === undefined || address(v.address)) && (v.port === undefined || port(v.port))
}

function validCase(raw: unknown): raw is NatCase {
  if (!record(raw) || !label(raw.label) || !packet(raw.packet)) return false
  switch (raw.kind) {
    case 'address': {
      if (!Array.isArray(raw.bindings) || raw.bindings.length > 12 || !raw.bindings.every(addressBinding)
        || !unique(raw.bindings.map(b => b.inside)) || !unique(raw.bindings.map(b => b.outside))
        || !Array.isArray(raw.pool) || raw.pool.length > 12 || !raw.pool.every(address) || !unique(raw.pool)) return false
      const pool = new Set(raw.pool)
      return raw.allocation === 'static' ? raw.pool.length === 0
        : raw.allocation === 'dynamic' && raw.pool.length > 0 && raw.bindings.every(b => pool.has(b.outside))
    }
    case 'pat': {
      if (!direction(raw.direction) || !address(raw.external) || !Array.isArray(raw.ports)
        || raw.ports.length === 0 || raw.ports.length > 12 || !raw.ports.every(port) || !unique(raw.ports)
        || !Array.isArray(raw.bindings) || raw.bindings.length > 16 || !raw.bindings.every(binding)
        || (raw.filtering !== 'any' && raw.filtering !== 'listed')) return false
      const slots = new Set(raw.ports)
      return raw.bindings.every(b => b.outside.address === raw.external && slots.has(b.outside.port))
        && unique(raw.bindings.map(b => `${b.protocol}:${endpointText(b.inside)}`))
        && unique(raw.bindings.map(b => `${b.protocol}:${endpointText(b.outside)}`))
    }
    case 'path':
      return direction(raw.direction) && Array.isArray(raw.stages) && raw.stages.length === 2 && raw.stages.every(binding)
    case 'publish':
      return name(raw.ingress) && Array.isArray(raw.rules) && raw.rules.length <= 10 && raw.rules.every(validRule)
        && unique(raw.rules.map(r => r.id)) && Array.isArray(raw.permitted) && raw.permitted.length <= 10
        && raw.permitted.every(endpoint) && unique(raw.permitted.map(endpointText))
    default: return false
  }
}

export function validNatProfile(raw: unknown): raw is NatProfile {
  return record(raw) && Array.isArray(raw.cases) && raw.cases.length > 0 && raw.cases.length <= 10
    && raw.cases.every(validCase) && unique(raw.cases.map(item => item.label))
}

export function natControls(profile: NatProfile): PredictionControl[] {
  return [{ label:'Caso', options:profile.cases.map(item => item.label), initial:profile.cases[0].label }]
}

const selection = (label: string, expected: string, options: string[]): PredictionAnswer => ({
  label, expected, options:[...new Set([...options,expected])],
})
const integer = (label: string, value: number): PredictionAnswer => ({ label, expected:String(value), format:'integer' })
const endpointFields = (title: string, endpoint: Endpoint | undefined, choices: string[]): PredictionAnswer[] => [
  selection(`Dirección IPv4 ${title}`,endpoint?.address ?? absent,[...choices,absent]),
  integer(`Puerto ${title} (0 si no hay salida)`,endpoint?.port ?? 0),
]
const packetText = (p: Packet) => `${p.protocol} · ${endpointText(p.source)} → ${endpointText(p.destination)}`
const bindingText = (b: Binding) => `${b.protocol} · ${endpointText(b.inside)} ↔ ${endpointText(b.outside)}`
const directionText = (d: Direction) => d === 'outbound' ? 'Ida hacia el exterior' : 'Vuelta hacia el interior'

function describeAddress(item: AddressCase): PredictionExercise {
  const { packet, allocation, bindings, pool } = item
  const assigned = bindings.find(b => b.inside === packet.source.address)
  const free = pool.find(candidate => !bindings.some(b => b.outside === candidate))
  const output = assigned?.outside ?? (allocation === 'dynamic' ? free : undefined)
  const state = assigned ? 'Existente' : output ? 'Nueva' : 'Sin asociación'
  const translated = output ? { address:output, port:packet.source.port } : undefined
  return {
    facts:[
      `Entrada. ${packetText(packet)}.`,
      allocation === 'static' ? 'NAT básica estática. Solo se aplican las asociaciones declaradas.'
        : `NAT básica dinámica. Se elige la primera dirección libre del conjunto, en el orden mostrado. Conjunto: ${pool.join(', ')}.`,
      ...bindings.map(b => `${b.inside} ↔ ${b.outside}.`),
    ],
    answers:[selection('Estado de la asociación',state,['Existente','Nueva','Sin asociación']),
      ...endpointFields('de origen emitido',translated,[packet.source.address,...bindings.map(b => b.outside),...pool])],
    steps:['Busca el origen en la tabla antes de usar el conjunto de direcciones. NAT básica conserva el puerto.'],
    trace:[
      assigned ? `La tabla ya asigna ${assigned.outside} al origen.` : 'El origen no figura en la tabla.',
      translated ? `Se emite ${packetText({ ...packet, source:translated })}. El destino se conserva.`
        : 'El perfil no dispone de una asociación para emitir el paquete.',
    ],
  }
}

function describePat(item: PortCase): PredictionExercise {
  const { packet, direction, external, ports, bindings, filtering } = item
  const outbound = direction === 'outbound'
  const transport = bindings.filter(b => b.protocol === packet.protocol)
  const bound = transport.find(b => outbound ? sameEndpoint(b.inside,packet.source) : sameEndpoint(b.outside,packet.destination))
  const free = ports.find(candidate => !transport.some(b => b.outside.port === candidate))
  const accepted = bound && (outbound || filtering === 'any' || bound.peers.some(peer => sameEndpoint(peer,packet.source)))
  const created = outbound && !bound && free !== undefined
  const output = accepted ? (outbound ? bound.outside : bound.inside)
    : created ? { address:external,port:free } : undefined
  const state = accepted ? 'Existente' : bound ? 'Filtrado por origen' : created ? 'Nueva' : 'Sin asociación'
  const key = outbound ? `${packet.protocol} + extremo interno ${endpointText(packet.source)}`
    : `${packet.protocol} + destino público ${endpointText(packet.destination)}`
  return {
    facts:[
      `${directionText(direction)}. Entrada. ${packetText(packet)}.`,
      `Extremo público ${external}. Puertos disponibles en orden: ${ports.join(', ')}. Se asigna por protocolo sin solapar asociaciones.`,
      'La asociación de ida se reutiliza por extremo interno, aunque cambie su destino. Cada caso tiene su propia tabla.',
      filtering === 'listed' ? 'En vuelta, la política exige que el origen figure entre los pares autorizados de la asociación.'
        : 'En vuelta, este perfil admite cualquier origen si se encuentra una asociación.',
      ...bindings.map(b => `${bindingText(b)}. Pares: ${b.peers.map(endpointText).join(', ') || 'ninguno'}.`),
    ],
    answers:[selection('Estado de la asociación y decisión',state,['Existente','Nueva','Sin asociación','Filtrado por origen']),
      ...endpointFields(outbound ? 'de origen emitido' : 'de destino emitido',output,
        [packet.source.address,packet.destination.address,external,...bindings.map(b => b.inside.address)])],
    steps:['Separa la búsqueda en la tabla de la política aplicada al origen de la respuesta.'],
    trace:[
      `Clave de consulta: ${key}.`,
      bound ? `Asociación: ${bindingText(bound)}.`
        : created ? `El primer puerto libre del protocolo es ${free}.` : 'No hay asociación utilizable.',
      output ? `Se emite ${packetText(outbound ? { ...packet, source:output } : { ...packet, destination:output })}.`
        : bound ? 'La política del perfil no admite el origen de la respuesta.' : 'El perfil no emite un paquete traducido.',
    ],
  }
}

function describePath(item: PathCase): PredictionExercise {
  const { packet, direction, stages } = item
  const outbound = direction === 'outbound'
  const ordered = outbound ? stages : [...stages].reverse()
  const translate = (current: Endpoint | undefined, stage: Binding) => {
    const match = outbound ? stage.inside : stage.outside
    if (current && packet.protocol === stage.protocol && sameEndpoint(current,match)) {
      return outbound ? stage.outside : stage.inside
    }
  }
  const input = outbound ? packet.source : packet.destination
  const first = translate(input,ordered[0])
  const second = translate(first,ordered[1])
  const addresses = stages.flatMap(stage => [stage.inside.address,stage.outside.address])
  const traceResult = (output: Endpoint | undefined) => output ? endpointText(output) : 'sin salida'
  return {
    facts:[
      `${directionText(direction)}. Entrada. ${packetText(packet)}.`,
      'Dos asociaciones ya fijadas. La ida aplica primero la del abonado; la vuelta empieza por la del proveedor. En este caso se admite la respuesta si coinciden las asociaciones.',
      `Abonado. ${bindingText(stages[0])}.`, `Proveedor. ${bindingText(stages[1])}.`,
    ],
    answers:[...endpointFields('después de la primera etapa',first,addresses),
      ...endpointFields('después de la segunda etapa',second,addresses)],
    steps:['Usa como entrada de cada etapa la salida anterior. Si una etapa carece de asociación, la siguiente no recibe ese paquete.'],
    trace:[
      `Orden del recorrido: ${outbound ? 'abonado, proveedor' : 'proveedor, abonado'}.`,
      `Primera etapa: ${endpointText(input)} → ${traceResult(first)}.`,
      `Segunda etapa: ${traceResult(first)} → ${traceResult(second)}.`,
    ],
  }
}

function describePublication(item: PublishCase): PredictionExercise {
  const { packet, ingress, rules, permitted } = item
  const selected = rules.find(r => (r.ingress === undefined || r.ingress === ingress)
    && (r.protocol === undefined || r.protocol === packet.protocol)
    && (r.address === undefined || r.address === packet.destination.address)
    && (r.port === undefined || r.port === packet.destination.port))
  const dest = selected?.destination
  const state = dest ? (permitted.some(entry => sameEndpoint(entry,dest)) ? 'Admitida' : 'No admitida') : 'Sin publicación'
  const ruleFacts = rules.map(r => `${r.id}. Entrada ${r.ingress ?? 'cualquiera'}; protocolo ${r.protocol ?? 'cualquiera'}; `
    + `destino ${r.address ?? '*'}:${r.port ?? '*'} → ${endpointText(r.destination)}.`)
  return {
    facts:[
      `Entrada ${ingress}. ${packetText(packet)}.`,
      'Se aplica la primera regla coincidente de esta etapa. Después se comprueba la lista de servicios permitidos.',
      ...ruleFacts,
      `Destinos admitidos por la política: ${permitted.map(endpointText).join(', ') || 'ninguno'}.`,
    ],
    answers:[
      selection('Regla seleccionada',selected?.id ?? noRule,[...rules.map(r => r.id),noRule]),
      ...endpointFields('de destino tras la traducción',dest,[packet.destination.address,...rules.map(r => r.destination.address)]),
      selection('Resultado de publicación',state,['Admitida','No admitida','Sin publicación']),
    ],
    steps:['Determina el primer acierto de la etapa de traducción. Evalúa la admisión del servicio sobre el destino resultante.'],
    trace:[
      selected ? `La primera coincidencia es ${selected.id}.` : 'Ninguna regla coincide con esta entrada.',
      dest ? `Destino después de DNAT: ${endpointText(dest)}.` : 'En esta etapa no se publica el destino.',
      `Decisión del perfil: ${state.toLowerCase()}.`,
    ],
  }
}

export function describeNat(profile: NatProfile, values: string[]): PredictionExercise {
  const item = profile.cases.find(candidate => candidate.label === values[0]) ?? profile.cases[0]
  switch (item.kind) {
    case 'address': return describeAddress(item)
    case 'pat': return describePat(item)
    case 'path': return describePath(item)
    case 'publish': return describePublication(item)
  }
}
