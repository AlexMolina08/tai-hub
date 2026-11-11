import { formatIPv4, validateInput } from './ipv4'
import type { PredictionControl, PredictionExercise } from './prediction'

export const LAN_VLAN_MODEL_VERSION = 'lan-vlan-model-v1'

type Access = { kind: 'access'; pvid: number; voice: number | null; priorityTagged: boolean }
type Trunk = { kind: 'trunk'; native: number; allowed: number[]; tagNative: boolean; admitUntagged: boolean }
type TagCase = {
  kind: 'tag'; label: string; ingress: Access | Trunk; wireVid: number | null
  tx: Trunk; rx: Trunk; destination: number
}
type TciCase = { kind: 'tci'; label: string; word: number; pvid: number }
type QosCase = {
  kind: 'qos'; label: string; pcp: number; dei: number; dscp: number; classifier: 'pcp' | 'dscp'
  trusted: boolean; remark: number; queues: Record<string, number>; dropDei: boolean
  congested: boolean; permitted: boolean
}
type Host = { vlan: number; address: string; gateway: string; connected: boolean }
type Interface = { name: string; vlan: number; address: string; active: boolean }
type RouteCase = {
  kind: 'route'; label: string; topology: 'router-on-a-stick' | 'switch-l3'
  source: Host; destination: Host; interfaces: Interface[]; allowed: number[] | null
  forwarding: boolean; permitted: boolean
}
type RelayCase = {
  kind: 'relay'; label: string; clientVlan: number; clientSvi: string; serverVlan: number
  serverAddress: string; helper: string | null; routeOut: boolean; routeBack: boolean
}
type Case = TagCase | TciCase | QosCase | RouteCase | RelayCase
export type LanVlanProfile = { cases: Case[] }

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && min <= value && value <= max
const vid = (value: unknown): value is number => integer(value, 1, 4094)
const vlanList = (value: unknown): value is number[] => Array.isArray(value) && value.length <= 24
  && value.every(vid) && new Set(value).size === value.length
const flag = (value: unknown): value is boolean => typeof value === 'boolean'
const label = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 80 && value.trim() === value && !/[\r\n]/.test(value)

function ipv4(raw: unknown) {
  if (typeof raw !== 'string' || !/^[\d.]+$/.test(raw)) return
  const result = validateInput({ address: raw, format: 'prefix', value: '32', probe: '', context: 'numeric' })
  return result.ok ? result.input.addressNumber : undefined
}

function interfaceAddress(raw: unknown) {
  if (typeof raw !== 'string' || !/^[\d.]+\/(?:[1-9]|[12][0-9]|30)$/.test(raw)) return
  const [text, prefix] = raw.split('/')
  const address = ipv4(text)
  if (address === undefined) return
  const size = 2 ** (32 - Number(prefix))
  const start = Math.floor(address / size) * size
  const end = start + size - 1
  if (address === start || address === end) return
  return { text, address, start, end, prefix }
}

type Block = NonNullable<ReturnType<typeof interfaceAddress>>
const includes = (block: Block, address: number) => block.start <= address && address <= block.end

function validAccess(value: unknown): value is Access {
  return record(value) && value.kind === 'access' && vid(value.pvid)
    && (value.voice === null || vid(value.voice) && value.voice !== value.pvid)
    && flag(value.priorityTagged)
}

function validTrunk(value: unknown): value is Trunk {
  return record(value) && value.kind === 'trunk' && vid(value.native) && vlanList(value.allowed)
    && flag(value.tagNative) && flag(value.admitUntagged)
}

function validHost(value: unknown): value is Host {
  return record(value) && vid(value.vlan) && !!interfaceAddress(value.address)
    && ipv4(value.gateway) !== undefined && flag(value.connected)
}

function validInterface(value: unknown): value is Interface {
  return record(value) && typeof value.name === 'string' && /^[a-zA-Z][a-zA-Z0-9/.:-]{0,23}$/.test(value.name)
    && vid(value.vlan) && !!interfaceAddress(value.address) && flag(value.active)
}

function validRoute(value: Record<string, unknown>): boolean {
  const { topology, source, destination, interfaces, allowed, forwarding, permitted } = value
  if (!validHost(source) || !validHost(destination) || source.vlan === destination.vlan
    || !Array.isArray(interfaces) || !integer(interfaces.length, 1, 8) || !interfaces.every(validInterface)
    || !flag(forwarding) || !flag(permitted)) return false
  if (!(topology === 'router-on-a-stick' && vlanList(allowed) || topology === 'switch-l3' && allowed === null)) return false
  if (new Set(interfaces.map(item => item.vlan)).size !== interfaces.length
    || new Set(interfaces.map(item => item.name)).size !== interfaces.length) return false
  const a = interfaceAddress(source.address)!
  const b = interfaceAddress(destination.address)!
  if (includes(a, b.address) || includes(b, a.address)) return false
  const networks = interfaces.filter(item => item.active).map(item => interfaceAddress(item.address)!)
  return networks.every((block, index) => networks.slice(index + 1).every(other => block.end < other.start || other.end < block.start))
}

function validRelay(value: Record<string, unknown>): boolean {
  const server = ipv4(value.serverAddress)
  const client = interfaceAddress(value.clientSvi)
  return vid(value.clientVlan) && vid(value.serverVlan) && !!client && server !== undefined
    && (value.helper === null || ipv4(value.helper) !== undefined) && flag(value.routeOut) && flag(value.routeBack)
    && includes(client, server) === (value.clientVlan === value.serverVlan)
}

function validQos(value: Record<string, unknown>): boolean {
  if (value.classifier !== 'pcp' && value.classifier !== 'dscp') return false
  const max = value.classifier === 'pcp' ? 7 : 63
  return integer(value.pcp, 0, 7) && integer(value.dei, 0, 1) && integer(value.dscp, 0, 63)
    && flag(value.trusted) && integer(value.remark, 0, max) && record(value.queues)
    && Object.entries(value.queues).every(([mark, queue]) =>
      /^(?:0|[1-9]\d?)$/.test(mark) && integer(Number(mark), 0, max) && integer(queue, 1, 8))
    && flag(value.dropDei) && flag(value.congested) && flag(value.permitted)
}

function validCase(value: unknown): value is Case {
  if (!record(value) || !label(value.label)) return false
  switch (value.kind) {
    case 'tag':
      return (validAccess(value.ingress) || validTrunk(value.ingress)) && validTrunk(value.tx)
        && validTrunk(value.rx) && (value.wireVid === null || integer(value.wireVid, 0, 4095)) && vid(value.destination)
    case 'tci': return integer(value.word, 0, 65535) && vid(value.pvid)
    case 'qos': return validQos(value)
    case 'route': return validRoute(value)
    case 'relay': return validRelay(value)
    default: return false
  }
}

export function validLanVlanProfile(value: unknown): value is LanVlanProfile {
  return record(value) && Array.isArray(value.cases) && integer(value.cases.length, 1, 8)
    && value.cases.every(validCase) && new Set(value.cases.map(item => item.label)).size === value.cases.length
}

export function lanVlanControls(profile: LanVlanProfile): PredictionControl[] {
  const options = profile.cases.map(item => item.label)
  return [{ label: 'Caso', options, initial: options[0] }]
}

const yn = (v: boolean) => v ? 'Sí' : 'No'
const numberAnswer = (label: string, value: number) => ({ label, expected: String(value), format: 'integer' as const })
const optionAnswer = (label: string, expected: string, options: string[]) =>
  ({ label, expected, options: [...new Set(options)] })
const tagText = (tag: number | null) => tag === null ? 'Sin etiqueta' : String(tag)
const names = (vlans: number[]) => vlans.join(', ') || 'ninguna'

function admit(port: Access | Trunk, tag: number | null): number | undefined {
  if (port.kind === 'access') {
    if (tag === null || tag === 0 && port.priorityTagged) return port.pvid
    return tag !== null && tag === port.voice ? tag : undefined
  }
  const vlan = tag === null || tag === 0 ? port.admitUntagged ? port.native : undefined : tag
  return vlan !== undefined && port.allowed.includes(vlan) ? vlan : undefined
}

function trunkFacts(port: Trunk) {
  return `nativa ${port.native}, permitidas ${names(port.allowed)}, nativa etiquetada: ${yn(port.tagNative)}, admite sin etiqueta o VID 0: ${yn(port.admitUntagged)}`
}

function describeTag(item: TagCase): PredictionExercise {
  const incoming = admit(item.ingress, item.wireVid)
  const sent = incoming !== undefined && item.tx.allowed.includes(incoming)
  const wire = sent && (incoming !== item.tx.native || item.tx.tagNative) ? incoming : null
  const received = sent ? admit(item.rx, wire) : undefined
  const delivery = received === item.destination
  const ingress = item.ingress.kind === 'access'
    ? `access ${item.ingress.pvid}, voz etiquetada: ${item.ingress.voice ?? 'no'}, admite VID 0: ${yn(item.ingress.priorityTagged)}`
    : trunkFacts(item.ingress)
  return {
    facts: [
      `Puerto de entrada: ${ingress}. Trama recibida: ${tagText(item.wireVid)}.`,
      `Troncal, lado emisor: ${trunkFacts(item.tx)}.`,
      `Troncal, lado receptor: ${trunkFacts(item.rx)}.`,
      `El puesto de destino está en un puerto access de VLAN ${item.destination}. Se presupone reenvío activo para las VLAN permitidas.`,
    ],
    answers: [
      numberAnswer('VLAN clasificada al ingreso (0 si se rechaza)', incoming ?? 0),
      optionAnswer('VID en el troncal o estado de la trama', sent ? tagText(wire) : 'Sin salida',
        ['Sin salida', 'Sin etiqueta', ...item.tx.allowed.map(String)]),
      numberAnswer('VLAN clasificada por el receptor (0 si no ingresa)', received ?? 0),
      optionAnswer('¿Puede llegar al puerto access de destino?', yn(delivery), ['Sí','No']),
    ],
    steps: ['Determina la VLAN interna, comprueba la salida de datos y clasifica otra vez según la etiqueta recibida.'],
    trace: [
      incoming === undefined ? 'El primer puerto rechaza la trama.' : `El primer puerto la clasifica en VLAN ${incoming}.`,
      sent ? `El troncal transmite: ${tagText(wire)}.` : 'El troncal no transmite esta trama.',
      received === undefined ? 'El lado receptor no incorpora la trama a una VLAN.' : `El lado receptor la clasifica en VLAN ${received}.`,
      delivery ? 'La VLAN coincide y el puerto de acceso puede entregar sin etiqueta.' : 'La trama no alcanza la VLAN del puerto de acceso de destino.',
    ],
  }
}

function describeTci(item: TciCase): PredictionExercise {
  const pcp = item.word >>> 13
  const dei = item.word >>> 12 & 1
  const vlan = item.word & 0xfff
  const assigned = vlan === 0 ? item.pvid : vlan === 4095 ? 0 : vlan
  const word = item.word.toString(16).toUpperCase().padStart(4,'0')
  return {
    facts: [
      `C-tag 0x8100, TCI 0x${word}, en orden de red. El puerto tiene PVID ${item.pvid} y admite etiquetas de prioridad.`,
      'El perfil admite el intervalo ordinario de VID y excluye 4095.',
    ],
    answers: [
      numberAnswer('PCP', pcp), numberAnswer('DEI', dei), numberAnswer('VID en la trama', vlan),
      numberAnswer('VLAN asignada (0 si se rechaza)', assigned),
    ],
    steps: ['Lee los tres bits más altos como PCP, el siguiente como DEI y los doce restantes como VID.'],
    trace: [
      `TCI 0x${word} contiene PCP ${pcp}, DEI ${dei} y VID ${vlan}.`,
      vlan === 0 ? `Es una etiqueta de prioridad. El puerto asigna su PVID ${item.pvid}.`
        : assigned ? `El VID ordinario identifica la VLAN ${assigned}.` : 'El VID 4095 se reserva y la trama se excluye en este perfil.',
    ],
  }
}

function describeQos(item: QosCase): PredictionExercise {
  const mark = item.trusted ? item[item.classifier] : item.remark
  const queue = item.permitted ? item.queues[mark] ?? 1 : 0
  const decision = !item.permitted ? 'Denegar' : item.congested && item.dropDei && !!item.dei ? 'Descartar' : 'Encolar'
  const classifier = item.classifier.toUpperCase()
  return {
    facts: [
      `Marcas recibidas: PCP ${item.pcp}, DEI ${item.dei}, DSCP ${item.dscp}.`,
      `Política de acceso para este flujo: ${item.permitted ? 'permitir' : 'denegar'}.`,
      `Clasificador ${classifier}. ${item.trusted ? 'Confía en la marca.' : 'Asigna ' + item.remark + ' en esta frontera.'}`,
      `Mapa de marcas a colas: ${Object.entries(item.queues).map(([key,value]) => key + '→' + value).join(', ') || 'vacío'}. Cola por defecto 1.`,
      `Congestión: ${yn(item.congested)}. Regla local de descarte de DEI 1 bajo congestión: ${yn(item.dropDei)}.`,
    ],
    answers: [
      numberAnswer('Marca que usaría el clasificador', mark),
      numberAnswer('Cola seleccionada (0 si el flujo está denegado)', queue),
      optionAnswer('Decisión de la política', decision, ['Denegar', 'Descartar', 'Encolar']),
    ],
    steps: ['Aplica por separado permiso, selección de marca, mapeo de cola y criterio de descarte.'],
    trace: [
      item.permitted ? 'El flujo está autorizado para su tratamiento en la salida.' : 'La política deniega el flujo; la marca no le concede acceso.',
      `El clasificador ${classifier} tomaría ${mark}.`,
      queue === 0 ? 'El flujo no selecciona cola.' : `La política selecciona cola ${queue}. Decisión: ${decision.toLowerCase()}.`,
    ],
  }
}

const noInput = 'Sin entrada L3'
const noOutput = 'Sin salida L3'
const routeStages = ['Acceso de origen', 'Troncal de origen', 'Puerta de origen', 'Encaminamiento desactivado',
  'Ruta o interfaz de salida', 'Política', 'VLAN de destino incorrecta', 'Troncal de destino', 'Acceso de destino', 'Entregado']
type RouteDecision = { status: string; ingress?: Interface; egress?: Interface; tags: number[] }

function forward(item: RouteCase): RouteDecision {
  const { source, destination, allowed } = item
  if (!source.connected) return { status: 'Acceso de origen', tags: [] }
  if (allowed && !allowed.includes(source.vlan)) return { status: 'Troncal de origen', tags: [] }
  const ingress = item.interfaces.find(link => link.vlan === source.vlan && link.active)
  const block = interfaceAddress(source.address)!
  const gateway = ipv4(source.gateway)!
  if (!ingress || interfaceAddress(ingress.address)!.address !== gateway || !includes(block,gateway)) {
    return { status: 'Puerta de origen', tags: [] }
  }
  const tags = allowed ? [source.vlan] : []
  if (!item.forwarding) return { status: 'Encaminamiento desactivado', ingress, tags }
  const target = interfaceAddress(destination.address)!.address
  const egress = item.interfaces.find(link => link.active && includes(interfaceAddress(link.address)!,target))
  if (!egress) return { status: 'Ruta o interfaz de salida', ingress, tags }
  const routed = { ingress, egress, tags }
  if (!item.permitted) return { ...routed, status: 'Política' }
  if (egress.vlan !== destination.vlan) return { ...routed, status: 'VLAN de destino incorrecta' }
  if (allowed && !allowed.includes(egress.vlan)) return { ...routed, status: 'Troncal de destino' }
  if (allowed) tags.push(egress.vlan)
  return { ...routed, status: destination.connected ? 'Entregado' : 'Acceso de destino' }
}

function describeRoute(item: RouteCase): PredictionExercise {
  const { source, destination, allowed } = item
  const { status, ingress, egress, tags } = forward(item)
  const labels = item.interfaces.map(i => i.name)
  return {
    facts: [
      item.topology === 'switch-l3' ? 'Dos puertos de acceso y SVI en el mismo switch L3.'
        : `Switch L2 y router externo. Troncal con etiquetas explícitas y VLAN permitidas: ${names(allowed ?? [])}.`,
      `Origen: ${source.address}, VLAN ${source.vlan}, puerta ${source.gateway}, acceso operativo: ${yn(source.connected)}.`,
      `Destino: ${destination.address}, VLAN ${destination.vlan}, acceso operativo: ${yn(destination.connected)}.`,
      ...item.interfaces.map(link => `${link.name}: VLAN ${link.vlan}, ${link.address}, activa: ${yn(link.active)}.`),
      `Solo hay rutas conectadas. Encaminamiento: ${yn(item.forwarding)}. Permiso para el flujo: ${yn(item.permitted)}.`,
      'El recuento corresponde al paquete IP estudiado. Las consultas de vecino quedan fuera del recuento.',
    ],
    answers: [
      optionAnswer('Resultado o primer punto de fallo', status, routeStages),
      numberAnswer('Cruces del troncal externo en este sentido', tags.length),
      optionAnswer('Interfaz L3 de entrada alcanzada', ingress?.name ?? noInput, [noInput, ...labels]),
      optionAnswer('Interfaz L3 de salida elegida', egress?.name ?? noOutput, [noOutput, ...labels]),
    ],
    steps: ['Primero comprueba acceso y puerta. Busca el destino en las redes conectadas activas y aplica política y camino de salida.'],
    trace: [
      ingress ? `El origen alcanza ${ingress.name} para VLAN ${ingress.vlan}.` : 'El origen no alcanza una interfaz L3 para este flujo.',
      egress ? `La red conectada del destino elige ${egress.name} para VLAN ${egress.vlan}.` : 'No se elige interfaz L3 de salida.',
      tags.length ? `Se observan en el troncal los VID ${tags.join(' y ')} en ese orden.` : 'No se observa cruce del troncal externo.',
      `Resultado: ${status}.`,
    ],
  }
}

function describeRelay(item: RelayCase): PredictionExercise {
  const link = interfaceAddress(item.clientSvi)!
  const scope = formatIPv4(link.start) + '/' + link.prefix
  const local = item.clientVlan === item.serverVlan
  const relayed = !local && item.helper === item.serverAddress && item.routeOut
  const statuses = ['Servidor local', 'Relay ida y vuelta', 'Sin retorno al relay', 'Sin llegada al servidor']
  const status = local ? statuses[0] : relayed ? statuses[item.routeBack ? 1 : 2] : statuses[3]
  return {
    facts: [
      `Cliente sin IPv4 en VLAN ${item.clientVlan}. Interfaz de puerta y relay: ${item.clientSvi}.`,
      `Servidor: ${item.serverAddress}, VLAN ${item.serverVlan}. Destino configurado para el relay: ${item.helper ?? 'ninguno'}.`,
      `Camino de ida: ${yn(item.routeOut)}. Camino de retorno al relay: ${yn(item.routeBack)}. Perfil clásico, sin selección adicional de enlace.`,
    ],
    answers: [
      optionAnswer('Resultado del descubrimiento y retorno', status, statuses),
      optionAnswer('giaddr observado en el servidor', relayed ? link.text : local ? '0.0.0.0' : 'Sin observación',
        ['0.0.0.0', link.text, item.serverAddress, 'Sin observación']),
      optionAnswer('Ámbito cliente que puede elegir el servidor', local || relayed ? scope : 'Sin selección',
        ['Sin selección', item.serverAddress + '/32', scope]),
      optionAnswer('Puerta IPv4 que debe ofrecer la opción 3', link.text, ['0.0.0.0', item.serverAddress, link.text]),
    ],
    steps: ['Distingue la puerta local de la IP del servidor. Comprueba dónde llega el broadcast y, si hay relay, sus dos trayectos.'],
    trace: [
      `El descubrimiento empieza en VLAN ${item.clientVlan}.`,
      local ? 'El servidor comparte el dominio de difusión; recibe directamente.'
        : relayed ? `El servidor recibe del relay con giaddr ${link.text}.` : 'No llega una solicitud al servidor indicado.',
      local || relayed ? `El ámbito cliente es ${scope}. Resultado: ${status}.` : `Resultado: ${status}.`,
    ],
  }
}

export function describeLanVlan(profile: LanVlanProfile, values: string[]): PredictionExercise {
  const item = profile.cases.find(row => row.label === values[0]) ?? profile.cases[0]
  switch (item.kind) {
    case 'tag': return describeTag(item)
    case 'tci': return describeTci(item)
    case 'qos': return describeQos(item)
    case 'route': return describeRoute(item)
    case 'relay': return describeRelay(item)
  }
}
