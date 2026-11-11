import type { PredictionControl, PredictionExercise } from './prediction'

export const LAN_REDUNDANCY_MODEL_VERSION = 'lan-redundancy-model-v1'

type Bridge = { name: string; priority: number; mac: string }
type Endpoint = { node: string; number: number; priority: number }
type Link = { name: string; a: Endpoint; b: Endpoint; cost: number; up: boolean }
type TreeCase = {
  kind: 'tree'; label: string; nodes: Bridge[]; links: Link[]; observer: string; observedLink: string
  mode: 'classic' | 'rapid'; instance: number
}
type Region = { name: string; revision: number; mapping: Record<string, number> }
type BpduCase = {
  kind: 'bpdu'; label: string; version: 0 | 2 | 3; cost: number; localCost: number | null
  root: string; sender: string; localRegion: Region | null; remoteRegion: Region | null
}
type GuardCase = {
  kind: 'guard'; label: string; edge: boolean; policy: 'none' | 'bpdu-guard' | 'root-guard' | 'loop-guard'
  event: 'arrival' | 'superior' | 'lost' | 'none'; role: 'root' | 'designated' | 'alternate'; scope: 'interface' | 'global-edge'
}
type Member = { port: number; rateMbps: number; up: boolean; fullDuplex: boolean; settingsMatch: boolean; peerReady: boolean }
type LagCase = {
  kind: 'lag'; label: string; leftMode: 'active' | 'passive' | 'on'; rightMode: 'active' | 'passive' | 'on'
  rateMbps: number; minLinks: number; members: Member[]; flows: number[]
}
type Counters = { rxBytes: number; txBytes: number; crc: number; late: number; drops: number }
type CounterCase = {
  kind: 'counter'; label: string; rateMbps: number; seconds: number; duplex: ('half' | 'full')[]
  start: Counters; end: Counters; captureA: number | null; captureB: number | null; comparable: boolean
}
type Scenario = TreeCase | BpduCase | GuardCase | LagCase | CounterCase
export type LanRedundancyProfile = { cases: Scenario[] }

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && min <= value && value <= max
const flag = (value: unknown): value is boolean => typeof value === 'boolean'
const alias = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]$/.test(value)
const label = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 80 && value.trim() === value && !/[\r\n]/.test(value)
const rate = (value: unknown): value is number => whole(value, 10, 100_000)
const cost = (value: unknown): value is number => whole(value, 0, 1_000_000_000)
const unique = (values: unknown[]) => new Set(values).size === values.length
const choice = (value: unknown, options: string[]) => typeof value === 'string' && options.includes(value)
const counterFields = ['rxBytes','txBytes','crc','late','drops'] as const

function validBridge(value: unknown): value is Bridge {
  return record(value) && alias(value.name) && whole(value.priority, 0, 61440) && value.priority % 4096 === 0
    && typeof value.mac === 'string' && /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(value.mac)
    && parseInt(value.mac.slice(0, 2), 16) % 2 === 0
}

function validEndpoint(value: unknown): value is Endpoint {
  return record(value) && alias(value.node) && whole(value.number, 1, 4095)
    && whole(value.priority, 0, 240) && value.priority % 16 === 0
}

function validLink(value: unknown): value is Link {
  return record(value) && label(value.name) && validEndpoint(value.a) && validEndpoint(value.b)
    && value.a.node !== value.b.node && whole(value.cost, 1, 200_000_000) && flag(value.up)
}

function connected(nodes: Bridge[], links: Link[]) {
  const visited = new Set([nodes[0].name])
  for (let i = 1; i < nodes.length; i++) {
    for (const { a, b, up } of links) {
      if (!up) continue
      if (visited.has(a.node)) visited.add(b.node)
      if (visited.has(b.node)) visited.add(a.node)
    }
  }
  return visited.size === nodes.length
}

function validTree(value: Record<string, unknown>): boolean {
  const { nodes, links, observer, observedLink, mode, instance } = value
  if (!Array.isArray(nodes) || !whole(nodes.length, 2, 8) || !nodes.every(validBridge)
    || !Array.isArray(links) || !whole(links.length, 1, 16) || !links.every(validLink)
    || !alias(observer) || !label(observedLink) || !choice(mode, ['classic','rapid']) || !whole(instance, 0, 4094)) return false
  const names = nodes.map(node => node.name)
  const endpoints = links.flatMap(link => [link.a,link.b])
  return unique(names) && unique(nodes.map(n => n.mac)) && unique(links.map(link => link.name))
    && endpoints.every(end => names.includes(end.node)) && unique(endpoints.map(end => end.node + '/' + end.number))
    && links.some(link => link.name === observedLink && [link.a.node,link.b.node].includes(observer))
    && connected(nodes,links)
    && solveTree(value as unknown as TreeCase).costs.get(observer)! <= 999_999_999
}

function validRegion(value: unknown): value is Region {
  return record(value) && label(value.name) && value.name.length <= 32 && whole(value.revision, 0, 65535)
    && record(value.mapping) && Object.keys(value.mapping).length <= 24 && Object.entries(value.mapping).every(([vlan,instance]) =>
      /^[1-9]\d{0,3}$/.test(vlan) && whole(Number(vlan),1,4094) && whole(instance,1,4094))
}

function validBpdu(value: Record<string, unknown>): boolean {
  if (!alias(value.root) || !alias(value.sender) || !cost(value.cost)) return false
  if (value.version === 3) return value.localCost === null && validRegion(value.localRegion) && validRegion(value.remoteRegion)
  return (value.version === 0 || value.version === 2) && whole(value.localCost,1,200_000_000)
    && value.cost + value.localCost <= 999_999_999 && value.localRegion === null && value.remoteRegion === null
}

function validGuard(value: Record<string, unknown>): boolean {
  return flag(value.edge) && choice(value.policy,['none','bpdu-guard','root-guard','loop-guard'])
    && choice(value.event,['arrival','superior','lost','none']) && choice(value.role,['root','designated','alternate'])
    && (value.scope === 'interface' || value.scope === 'global-edge' && value.policy === 'bpdu-guard')
}

function validMember(value: unknown): value is Member {
  return record(value) && whole(value.port,1,16) && rate(value.rateMbps) && flag(value.up)
    && flag(value.fullDuplex) && flag(value.settingsMatch) && flag(value.peerReady)
}

function validLag(value: Record<string, unknown>): boolean {
  const modes = ['active','passive','on']
  const { leftMode, rightMode, minLinks, members, flows } = value
  return choice(leftMode,modes) && choice(rightMode,modes) && rate(value.rateMbps)
    && Array.isArray(members) && whole(members.length,1,8) && members.every(validMember)
    && unique(members.map(m => m.port)) && whole(minLinks,1,members.length)
    && (leftMode !== 'on' || rightMode !== 'on' || minLinks === 1)
    && Array.isArray(flows) && whole(flows.length,1,8) && flows.every(item => whole(item,0,255))
}

function validCounters(value: unknown): value is Counters {
  return record(value) && counterFields.every(key => whole(value[key],0,1_000_000_000_000))
}

function validCounter(value: Record<string, unknown>): boolean {
  const { seconds, rateMbps, duplex, start, end, captureA, captureB, comparable } = value
  if (!whole(seconds,1,3600) || !rate(rateMbps) || !Array.isArray(duplex) || duplex.length !== 2
    || !duplex.every(mode => choice(mode,['half','full'])) || !validCounters(start) || !validCounters(end)
    || !counterFields.every(key => start[key] <= end[key]) || !flag(comparable)) return false
  const hasCaptures = whole(captureA,0,1_000_000) && whole(captureB,0,1_000_000)
  if (!(hasCaptures || captureA === null && captureB === null)
    || comparable && !(hasCaptures && Math.abs(captureA-captureB) <= 99)) return false
  if ((['crc','late','drops'] as const).some(key => end[key] - start[key] > 999_999_999)) return false
  const total = seconds * rateMbps * 1_000_000
  return (['rxBytes','txBytes'] as const).every(key => {
    const scaled = (end[key] - start[key]) * 800
    return scaled <= total * 100 && scaled % total === 0
  })
}

function validScenario(value: unknown): value is Scenario {
  if (!record(value) || !label(value.label)) return false
  switch (value.kind) {
    case 'tree': return validTree(value)
    case 'bpdu': return validBpdu(value)
    case 'guard': return validGuard(value)
    case 'lag': return validLag(value)
    case 'counter': return validCounter(value)
    default: return false
  }
}

export function validLanRedundancyProfile(value: unknown): value is LanRedundancyProfile {
  return record(value) && Array.isArray(value.cases) && whole(value.cases.length,1,8)
    && value.cases.every(validScenario) && unique(value.cases.map(item => item.label))
}

export function lanRedundancyControls(profile: LanRedundancyProfile): PredictionControl[] {
  const options = profile.cases.map(row => row.label)
  return [{ label: 'Caso', options, initial: options[0] }]
}

const integerAnswer = (label: string, value: number) => ({ label, expected: String(value), format: 'integer' as const })
const optionAnswer = (label: string, expected: string, options: string[]) => ({ label, expected, options })
const yn = (value: boolean) => value ? 'Sí' : 'No'
const booleanAnswer = (label: string, value: boolean) => optionAnswer(label,yn(value),['Sí','No'])
const portId = (port: Endpoint) => port.priority * 256 + port.number
const rootForward = 'Raíz · Reenvío'
const designatedForward = 'Designado · Reenvío'
const alternateDiscard = 'Alternativo · Descartando'
const classicBlocking = 'No designado · Bloqueo'
const disabled = 'Deshabilitado'
const roles = [rootForward,designatedForward,alternateDiscard,classicBlocking,disabled]

function compareBridges(a: Bridge, b: Bridge) {
  return a.priority - b.priority || a.mac.localeCompare(b.mac)
}

function solveTree(item: TreeCase) {
  const bridges = new Map(item.nodes.map(node => [node.name,node]))
  const root = [...item.nodes].sort(compareBridges)[0].name
  const costs = new Map(item.nodes.map(node => [node.name,node.name === root ? 0 : Infinity]))
  const active = item.links.filter(link => link.up)
  for (let i = 1; i < item.nodes.length; i++) {
    for (const { a, b, cost } of active) {
      const before = costs.get(a.node)!
      costs.set(a.node,Math.min(before,costs.get(b.node)!+cost))
      costs.set(b.node,Math.min(costs.get(b.node)!,before+cost))
    }
  }
  const compareNode = (a: Endpoint, b: Endpoint) => compareBridges(bridges.get(a.node)!,bridges.get(b.node)!)
  const rootPorts = new Map<string,number>()
  for (const node of item.nodes) {
    if (node.name === root) continue
    const candidates = active.flatMap(({ a, b, cost }) => {
      if (a.node !== node.name && b.node !== node.name) return []
      const [local,peer] = a.node === node.name ? [a,b] : [b,a]
      return [{ local, peer, total:costs.get(peer.node)!+cost }]
    })
    candidates.sort((a,b) => a.total - b.total || compareNode(a.peer,b.peer)
      || portId(a.peer) - portId(b.peer) || portId(a.local) - portId(b.local))
    rootPorts.set(node.name,candidates[0].local.number)
  }
  const state = (link: Link, local: Endpoint, peer: Endpoint) => {
    if (!link.up) return disabled
    if (rootPorts.get(local.node) === local.number) return rootForward
    const comparison = costs.get(local.node)! - costs.get(peer.node)! || compareNode(local,peer) || portId(local) - portId(peer)
    if (comparison < 0) return designatedForward
    return item.mode === 'rapid' ? alternateDiscard : classicBlocking
  }
  const observed = item.links.find(link => link.name === item.observedLink)!
  const [local,peer] = observed.a.node === item.observer ? [observed.a,observed.b] : [observed.b,observed.a]
  return { root, costs, rootPorts, role:state(observed,local,peer),
    links:item.links.map(link => [link.name,state(link,link.a,link.b),state(link,link.b,link.a)]) }
}

function describeTree(item: TreeCase): PredictionExercise {
  const result = solveTree(item)
  const bridgeNames = item.nodes.map(node => node.name).sort()
  const portText = (p: Endpoint) => p.node + ' p' + p.number + ' (' + p.priority + '.' + p.number + ')'
  return {
    facts: [
      `Instantánea convergida ${item.mode === 'rapid' ? 'rápida' : 'clásica'} de una sola instancia ${item.instance}. Cada enlace punto a punto tiene igual coste en ambos extremos.`,
      ...item.nodes.map(n => `Puente ${n.name}. Prioridad base ${n.priority}, MAC ${n.mac}.`),
      ...item.links.map(link => `Enlace ${link.name}: ${portText(link.a)} — ${portText(link.b)}, coste ${link.cost}, activo: ${yn(link.up)}.`),
      `Observa el puente ${item.observer} y su puerto en el enlace ${item.observedLink}.`,
    ],
    answers: [
      optionAnswer('Puente raíz de la instancia',result.root,bridgeNames),
      integerAnswer('Coste total del puente observado hacia la raíz',result.costs.get(item.observer)!),
      integerAnswer('Número de puerto raíz del puente observado (0 si es la raíz)',result.rootPorts.get(item.observer) ?? 0),
      optionAnswer('Papel y estado del puerto en el enlace observado',result.role,roles),
    ],
    steps:['Compara Bridge ID, suma los costes hacia la raíz y usa Bridge ID y Port ID para desempatar los caminos.'],
    trace:[
      `La raíz es ${result.root}. Todos comparten la extensión de sistema de esta instancia.`,
      `Costes a raíz: ${bridgeNames.map(name => name + '→' + result.costs.get(name)).join(', ')}.`,
      `Puertos raíz: ${bridgeNames.map(name => name + '→' + (result.rootPorts.get(name) ?? 'ninguno')).join(', ')}.`,
      ...result.links.map(([name,a,b]) => `${name}: ${a} / ${b} según el orden de extremos de la ficha.`),
    ],
  }
}

const versions = { 0:'STP clásico', 2:'RSTP', 3:'MSTP' }
const regionStatus = ['No aplica','Misma región','Región distinta']

function sameRegion(a: Region,b: Region) {
  const pairs = Object.entries(a.mapping)
  return a.name === b.name && a.revision === b.revision && pairs.length === Object.keys(b.mapping).length
    && pairs.every(([vlan,instance]) => b.mapping[vlan] === instance)
}

function describeBpdu(item: BpduCase): PredictionExercise {
  const same = item.sender === item.root
  const receivedCost = item.localCost === null ? null : item.cost + item.localCost
  const local = item.localRegion
  const remote = item.remoteRegion
  const region = local && remote ? regionStatus[sameRegion(local,remote) ? 1 : 2] : regionStatus[0]
  const regionText = (r: Region) => `${r.name}, revisión ${r.revision}, mapa ${Object.entries(r.mapping).map(([v,i]) => v + '→' + i).join(', ') || 'vacío'}`
  return {
    facts:[
      `Versión de BPDU ${item.version}. Identidad raíz anunciada: ${item.root}. Identidad del puente emisor: ${item.sender}.`,
      ...(receivedCost === null ? [] : [`Coste anunciado ${item.cost}. Coste del puerto receptor ${item.localCost}.`]),
      ...(local && remote ? [`Región local: ${regionText(local)}.`,`Región anunciada: ${regionText(remote)}.`,
        'Las VLAN fuera del mapa expreso se asignan a la instancia 0. El coste regional no se calcula aquí.'] : []),
    ],
    answers:[
      optionAnswer('Variante según el campo versión',versions[item.version],Object.values(versions)),
      booleanAnswer('¿Coincide el emisor con la raíz anunciada?',same),
      ...(receivedCost === null ? [] : [integerAnswer('Coste candidato recibido más coste del puerto',receivedCost)]),
      optionAnswer('Coincidencia de configuración de región',region,regionStatus),
    ],
    steps:['Identifica la versión, separa los identificadores de raíz y emisor y aplica la regla que corresponda al registro.'],
    trace:[
      `La versión corresponde a ${versions[item.version]}. ${same ? 'El emisor coincide con la raíz.' : 'El emisor es otro puente.'}`,
      receivedCost === null ? `La comparación por nombre, revisión y mapa da: ${region.toLowerCase()}.`
        : `El camino candidato suma ${item.cost} + ${item.localCost} = ${receivedCost}.`,
    ],
  }
}

const guardStates = ['Reenvío de borde','Error-disabled','Root-inconsistent','Loop-inconsistent','Sin acción de la guarda']
const events = { none:'sin BPDU observada', arrival:'llega una BPDU', superior:'llega una BPDU superior', lost:'deja de llegar la BPDU esperada' }

function describeGuard(item: GuardCase): PredictionExercise {
  const { edge, policy, event, role, scope } = item
  const bpduGuard = policy === 'bpdu-guard' && (event === 'arrival' || event === 'superior') && (scope === 'interface' || edge)
  const rootGuard = policy === 'root-guard' && event === 'superior' && role === 'designated'
  const loopGuard = policy === 'loop-guard' && event === 'lost' && (role === 'root' || role === 'alternate')
  const result = guardStates[bpduGuard ? 1 : rootGuard ? 2 : loopGuard ? 3 : edge && event === 'none' ? 0 : 4]
  const forwarding = !(bpduGuard || rootGuard || loopGuard) && (edge && event === 'none' || role !== 'alternate')
  return {
    facts:[
      `Perfil Catalyst 9300. Borde operativo: ${yn(edge)}. Rol anterior: ${role === 'root' ? 'raíz' : role === 'alternate' ? 'alternativo' : 'designado'}.`,
      `Protección: ${policy}. Alcance: ${scope === 'interface' ? 'interfaz' : 'global en borde operativo'}.`,
      `Registro de incidente: ${events[event]}.`,
    ],
    answers:[optionAnswer('Resultado de borde o de la guarda',result,guardStates),booleanAnswer('¿El puerto reenvía en este caso?',forwarding)],
    steps:['Distingue la llegada, la superioridad o la pérdida de una BPDU antes de aplicar la guarda configurada.'],
    trace:[`Se observa que ${events[event]}.`,`Estado: ${result}. Reenvío: ${yn(forwarding)}.`],
  }
}

const lacp = 'LACP'
const staticLag = 'Estático'
const noLag = 'Sin agregado común'

function describeLag(item: LagCase): PredictionExercise {
  const { leftMode, rightMode, rateMbps } = item
  const protocol = leftMode === 'on' && rightMode === 'on' ? staticLag
    : leftMode !== 'on' && rightMode !== 'on' && (leftMode === 'active' || rightMode === 'active') ? lacp : noLag
  const eligible = item.members.filter(m => protocol !== noLag && m.up && m.fullDuplex && m.settingsMatch
    && m.rateMbps === rateMbps && (protocol === staticLag || m.peerReady)).map(m => m.port).sort((a,b) => a - b)
  const active = eligible.length >= item.minLinks
  const cap = active ? eligible.length * rateMbps : 0
  const single = active ? rateMbps : 0
  const assigned = active ? item.flows.map(bucket => eligible[bucket % eligible.length]) : []
  const status = active ? 'Activo' : 'Inactivo'
  return {
    facts:[
      `Agregado L2. Modos: ${leftMode} y ${rightMode}. Tasa por miembro compatible: ${rateMbps} Mbit/s en un sentido. Umbral de actividad: ${item.minLinks}.`,
      ...item.members.map(m => `Puerto ${m.port}. ${m.rateMbps} Mbit/s, activo: ${yn(m.up)}, dúplex completo: ${yn(m.fullDuplex)}, configuración L2 compatible: ${yn(m.settingsMatch)}, par sincronizado: ${yn(m.peerReady)}.`),
      `Cubetas de flujos en orden: ${item.flows.join(', ')}. Modelo de reparto: resto de la cubeta entre el número de miembros útiles, indexado desde 0 sobre puertos ordenados.`,
    ],
    answers:[
      optionAnswer('Modalidad común de agregación',protocol,[lacp,staticLag,noLag]),
      integerAnswer('Miembros elegibles antes del umbral',eligible.length),
      optionAnswer('Estado del agregado',status,['Activo','Inactivo']),
      integerAnswer('Capacidad agregada nominal en un sentido (Mbit/s)',cap),
      integerAnswer('Cota nominal de un flujo con reparto estable (Mbit/s)',single),
      { label:'Puertos de los flujos en el orden dado (o -)', expected:assigned.join(',') || '-', format:'signed-list' },
    ],
    steps:['Identifica la modalidad común, filtra los candidatos compatibles y aplica el umbral antes de repartir flujos.'],
    trace:[
      `La modalidad es ${protocol}. Los puertos elegibles son ${eligible.join(', ') || 'ninguno'}.`,
      `El umbral deja el agregado ${status.toLowerCase()}. Capacidad ${cap} Mbit/s y cota de un flujo ${single} Mbit/s.`,
      active ? `Asignación en el orden dado: ${assigned.join(', ')}.` : 'No se distribuyen flujos por el agregado.',
    ],
  }
}

function describeCounter(item: CounterCase): PredictionExercise {
  const { start,end,seconds,rateMbps } = item
  const rx = (end.rxBytes - start.rxBytes) * 800 / (seconds * rateMbps * 1_000_000)
  const tx = (end.txBytes - start.txBytes) * 800 / (seconds * rateMbps * 1_000_000)
  const difference = (key: keyof Counters) => end[key] - start[key]
  const mismatch = item.duplex[0] !== item.duplex[1]
  const gap = item.comparable ? String(item.captureA! - item.captureB!) : 'No comparable'
  return {
    facts:[
      `Ventana ${seconds} s sin reinicio ni vueltas de contador. Tasa nominal ${rateMbps} Mbit/s por sentido. Dúplex observado: ${item.duplex.join(' / ')}.`,
      `Contadores inicio → fin. Rx octetos ${start.rxBytes}→${end.rxBytes}, Tx octetos ${start.txBytes}→${end.txBytes}.`,
      `CRC ${start.crc}→${end.crc}, colisiones tardías ${start.late}→${end.late}, descartes de salida ${start.drops}→${end.drops}.`,
      item.captureA === null ? 'No hay capturas pareadas en este caso.'
        : `Capturas en A y B: ${item.captureA} y ${item.captureB} tramas. Mismo flujo, ventana y criterio de captura verificados: ${yn(item.comparable)}.`,
    ],
    answers:[
      integerAnswer('Utilización de Rx por octetos contados (%)',rx),
      integerAnswer('Utilización de Tx por octetos contados (%)',tx),
      integerAnswer('Incremento de CRC',difference('crc')),
      integerAnswer('Incremento de colisiones tardías',difference('late')),
      integerAnswer('Incremento de descartes de salida',difference('drops')),
      booleanAnswer('¿Hay discrepancia de dúplex entre los extremos?',mismatch),
      { label:'Diferencia entre A y B (A menos B, o - si no son comparables)', expected:item.comparable ? gap : '-', format:'signed-list' },
    ],
    steps:['Resta contadores acumulados y calcula cada utilización por separado. Alinea flujo y ventana antes de comparar capturas.'],
    trace:[
      `Los octetos contados dan ${rx} % en Rx y ${tx} % en Tx. El porcentaje no incluye sobrecarga fuera del contador.`,
      `Incrementos de CRC, colisiones tardías y descartes de salida: ${difference('crc')}, ${difference('late')} y ${difference('drops')}.`,
      `Discrepancia de dúplex: ${yn(mismatch)}. Diferencia de capturas: ${gap}. Un contador o captura por sí solo no identifica la causa.`,
    ],
  }
}

export function describeLanRedundancy(profile: LanRedundancyProfile, values: string[]): PredictionExercise {
  const item = profile.cases.find(row => row.label === values[0]) ?? profile.cases[0]
  switch (item.kind) {
    case 'tree': return describeTree(item)
    case 'bpdu': return describeBpdu(item)
    case 'guard': return describeGuard(item)
    case 'lag': return describeLag(item)
    case 'counter': return describeCounter(item)
  }
}
