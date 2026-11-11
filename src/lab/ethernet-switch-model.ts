import type { PredictionAnswer, PredictionControl, PredictionExercise } from './prediction'

export const ETHERNET_SWITCH_MODEL_VERSION = 'ethernet-switch-model-v1'

type Membership = { vlans: number[]; blockedVlans: number[] }
type Port = Membership & { number: number }
type Link = Membership & { a: string; b: string }
type Row = { vlan: number; mac: string; port: number; seen?: number }
type Frame = { time: number; vlan: number; ingress: number; source: string; destination: string }
type Question = { frame: number; field: 'outputs' } | { frame: number; field: 'learnedPort'; mac: string }
type FdbCase = { kind: 'fdb'; label: string; age: number; ports: Port[]; initial: Row[]; frames: Frame[]; questions: Question[] }
type TimingCase = { kind: 'timing'; label: string; bitsPerMicrosecond: number; frameBytes: number; decisionBytes: number; validFcs: boolean }
type LoopCase = { kind: 'loop'; label: string; start: string; vlan: number; links: Link[] }
type SwitchCase = FdbCase | TimingCase | LoopCase
export type EthernetSwitchProfile = { cases: SwitchCase[] }

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const bounded = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && min <= value && value <= max
const alias = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]$/.test(value)
const vlanId = (value: unknown): value is number => bounded(value, 1, 4094)
const clock = (value: unknown): value is number => bounded(value, 0, 100_000)
const numbers = (value: unknown): value is number[] => Array.isArray(value) && value.length <= 8
  && value.every(vlanId) && new Set(value).size === value.length
const label = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 80 && value.trim() === value && !/[\r\n]/.test(value)
const canForward = (link: Membership, vlan: number) =>
  link.vlans.includes(vlan) && !link.blockedVlans.includes(vlan)
const macKey = (vlan: number, mac: string) => vlan + '/' + mac

function validMembership(value: Record<string, unknown>): value is Record<string, unknown> & Membership {
  if (!numbers(value.vlans) || !value.vlans.length || !numbers(value.blockedVlans)) return false
  const vlans = value.vlans
  return value.blockedVlans.every(vlan => vlans.includes(vlan))
}

function validPort(value: unknown): value is Port {
  return record(value) && bounded(value.number, 1, 12) && validMembership(value)
}

function validRow(value: unknown): value is Row {
  return record(value) && vlanId(value.vlan) && alias(value.mac) && bounded(value.port, 1, 12)
    && (value.seen === undefined || clock(value.seen))
}

function validFrame(value: unknown): value is Frame {
  return record(value) && clock(value.time) && vlanId(value.vlan) && bounded(value.ingress, 1, 12)
    && alias(value.source) && (value.destination === '*' || alias(value.destination))
}

function validQuestion(value: unknown, count: number): value is Question {
  if (!record(value) || !bounded(value.frame, 1, count)) return false
  return value.field === 'outputs' ? value.mac === undefined : value.field === 'learnedPort' && alias(value.mac)
}

function validFdb(value: Record<string, unknown>): boolean {
  const { age, ports, initial, frames, questions } = value
  if (!bounded(age, 1, 100_000)
    || !Array.isArray(ports) || !bounded(ports.length, 2, 8) || !ports.every(validPort)
    || !Array.isArray(initial) || initial.length > 20 || !initial.every(validRow)
    || !Array.isArray(frames) || !bounded(frames.length, 1, 10) || !frames.every(validFrame)
    || !Array.isArray(questions) || !bounded(questions.length, 1, 6)
    || !questions.every(q => validQuestion(q, frames.length))) return false
  const byPort = new Map(ports.map(port => [port.number, port]))
  if (byPort.size !== ports.length || new Set(initial.map(row => macKey(row.vlan, row.mac))).size !== initial.length) return false
  if (new Set(questions.map(q => q.frame + '/' + q.field + ('mac' in q ? '/' + q.mac : ''))).size !== questions.length) return false
  return initial.every(row => {
    const port = byPort.get(row.port)
    return port?.vlans.includes(row.vlan) && (row.seen === undefined || row.seen <= frames[0].time)
  }) && frames.every((frame, index) => {
    const ingress = byPort.get(frame.ingress)
    return !!ingress && canForward(ingress, frame.vlan) && (index === 0 || frames[index - 1].time < frame.time)
  })
}

function validTiming(value: Record<string, unknown>): boolean {
  const { bitsPerMicrosecond, frameBytes, decisionBytes, validFcs } = value
  return bounded(bitsPerMicrosecond, 1, 10_000) && bounded(frameBytes, 64, 1522)
    && bounded(decisionBytes, 6, frameBytes - 1) && typeof validFcs === 'boolean'
    && 8 * decisionBytes % bitsPerMicrosecond === 0 && 8 * frameBytes % bitsPerMicrosecond === 0
}

function validLink(value: unknown): value is Link {
  return record(value) && alias(value.a) && alias(value.b) && value.a !== value.b && validMembership(value)
}

function validCase(value: unknown): value is SwitchCase {
  if (!record(value) || !label(value.label)) return false
  switch (value.kind) {
    case 'fdb': return validFdb(value)
    case 'timing': return validTiming(value)
    case 'loop': {
      const { start, vlan, links } = value
      return alias(start) && vlanId(vlan) && Array.isArray(links) && bounded(links.length, 1, 12)
        && links.every(validLink) && links.some(link => link.a === start || link.b === start)
    }
    default: return false
  }
}

export function validEthernetSwitchProfile(value: unknown): value is EthernetSwitchProfile {
  return record(value) && Array.isArray(value.cases) && bounded(value.cases.length, 1, 8)
    && value.cases.every(validCase) && new Set(value.cases.map(item => item.label)).size === value.cases.length
}

export function ethernetSwitchControls(profile: EthernetSwitchProfile): PredictionControl[] {
  const options = profile.cases.map(item => item.label)
  return [{ label: 'Caso', options, initial: options[0] }]
}

function portList(ports: number[]) {
  return ports.length ? ports.join(',') : '-'
}

function describeFdb(item: FdbCase): PredictionExercise {
  const table = new Map(item.initial.map(row => [macKey(row.vlan, row.mac), row]))
  const results = item.frames.map(frame => {
    const removed: string[] = []
    for (const [key, row] of table) {
      if (row.seen !== undefined && frame.time - row.seen >= item.age) {
        table.delete(key)
        removed.push(key)
      }
    }
    const key = macKey(frame.vlan, frame.source)
    const previous = table.get(key)
    const learned = !previous || previous.seen !== undefined
    if (learned) {
      table.set(key, { vlan: frame.vlan, mac: frame.source, port: frame.ingress, seen: frame.time })
    }
    const destination = table.get(macKey(frame.vlan, frame.destination))
    const outputs = item.ports
      .filter(port => canForward(port, frame.vlan) && port.number !== frame.ingress
        && (!destination || destination.port === port.number))
      .map(port => port.number).sort((a, b) => a - b)
    return { removed, learned, outputs, destination, rows: new Map(table) }
  })

  const answers: PredictionAnswer[] = item.questions.map(question => {
    const result = results[question.frame - 1]
    const frame = item.frames[question.frame - 1]
    return question.field === 'outputs'
      ? { label: `Trama ${question.frame}: puertos de salida (orden ascendente o -)`, format: 'signed-list', expected: portList(result.outputs) }
      : { label: `Tras trama ${question.frame}: puerto de ${question.mac} en VLAN ${frame.vlan} (0 si no figura)`,
        format: 'integer', expected: String(result.rows.get(macKey(frame.vlan, question.mac))?.port ?? 0) }
  })

  return {
    facts: [
      `Aging de filas dinámicas: ${item.age} s desde su última aparición como origen. Se aplica antes de procesar cada trama.`,
      'Las letras representan MAC individuales de 48 bits. El símbolo * representa la MAC broadcast.',
      ...item.ports.map(port => `Puerto ${port.number}. VLAN ${port.vlans.join(', ')}. Bloqueadas: ${port.blockedVlans.join(', ') || 'ninguna'}.`),
      item.initial.length ? `Tabla inicial: ${item.initial.map(row => `${row.vlan}/${row.mac} → ${row.port} (${row.seen === undefined ? 'estática' : 'último origen t=' + row.seen + ' s'})`).join('; ')}.`
        : 'Tabla inicial vacía.',
      ...item.frames.map((frame, i) => `Trama ${i + 1}. t=${frame.time} s. VLAN ${frame.vlan}, entrada ${frame.ingress}. ${frame.source} → ${frame.destination}.`),
    ],
    answers,
    steps: ['Primero caducan las filas dinámicas vencidas. Después se aprende por origen y se consulta el destino de la VLAN.'],
    trace: results.map(({ removed, learned, outputs, destination, rows }, i) => {
      const frame = item.frames[i]
      const expired = removed.length ? `Caducan ${removed.join(', ')}. ` : ''
      const learn = learned ? `Se registra ${frame.source} por ${frame.ingress}.` : `Se conserva la fila estática de ${frame.source}.`
      const lookup = frame.destination === '*' ? 'Broadcast.' : destination
        ? `Destino conocido por ${destination.port}.` : 'Destino desconocido.'
      const fdb = [...rows.values()].sort((a, b) => a.vlan - b.vlan || a.mac.localeCompare(b.mac))
        .map(row => `${row.vlan}/${row.mac}→${row.port}`).join(', ')
      return `Trama ${i + 1}. ${expired}${learn} ${lookup} Salidas: ${outputs.join(', ') || 'ninguna'}. Tabla: ${fdb}.`
    }),
  }
}

function describeTiming(item: TimingCase): PredictionExercise {
  const cut = 8 * item.decisionBytes / item.bitsPerMicrosecond
  const store = 8 * item.frameBytes / item.bitsPerMicrosecond
  const choices = ['Sí', 'No']
  return {
    facts: [
      `Trama MAC de ${item.frameBytes} octetos; se puede decidir el destino al recibir ${item.decisionBytes} octetos. FCS ${item.validFcs ? 'válido' : 'incorrecto'}.`,
      `Entrada y salida a ${item.bitsPerMicrosecond} bit/µs. Salida libre. Se mide desde el primer octeto MAC y se omiten propagación, colas y procesamiento.`,
    ],
    answers: [
      { label: 'Cut-through: instante de decisión (µs)', expected: String(cut), format: 'integer' },
      { label: 'Store-and-forward: instante de comprobación (µs)', expected: String(store), format: 'integer' },
      { label: '¿Cut-through llega a iniciar la salida?', expected: 'Sí', options: choices },
      { label: '¿Store-and-forward llega a iniciar la salida?', expected: item.validFcs ? 'Sí' : 'No', options: choices },
    ],
    steps: ['Cada instante resulta de dividir los bits recibidos por la tasa en bit/µs.'],
    trace: [
      `Cut-through puede decidir e iniciar salida en ${cut} µs.`,
      `Store-and-forward verifica FCS en ${store} µs y ${item.validFcs ? 'comienza el envío' : 'descarta antes de enviar'}.`,
    ],
  }
}

function describeLoop(item: LoopCase): PredictionExercise {
  const active = item.links.filter(link => canForward(link, item.vlan))
  const nodes = new Set([item.start])
  const visited = new Set<number>()
  const queue = [item.start]
  for (const node of queue) {
    active.forEach(({ a, b }, index) => {
      if (a !== node && b !== node) return
      visited.add(index)
      const neighbor = a === node ? b : a
      if (!nodes.has(neighbor)) {
        nodes.add(neighbor)
        queue.push(neighbor)
      }
    })
  }
  const cycle = visited.size >= nodes.size
  return {
    facts: [
      `Punto de observación ${item.start}, VLAN ${item.vlan}. Cada enlace enumerado es físico y el estado se aplica a ambos extremos.`,
      ...item.links.map((link, index) =>
        `Enlace ${index + 1}, ${link.a}–${link.b}. VLAN ${link.vlans.join(', ')}. Bloqueadas: ${link.blockedVlans.join(', ') || 'ninguna'}.`),
    ],
    answers: [
      { label: '¿Hay ciclo de reenvío alcanzable en esa VLAN?', expected: cycle ? 'Sí' : 'No', options: ['Sí', 'No'] },
      { label: 'Enlaces activos alcanzables en esa VLAN', expected: String(visited.size), format: 'integer' },
    ],
    steps: ['Comprueba los enlaces de la VLAN que están en reenvío y pertenecen al componente observado. Un componente sin ciclo tiene un enlace menos que nodos.'],
    trace: [
      `Switches alcanzables: ${[...nodes].sort().join(', ')}.`,
      `Enlaces del componente: ${[...visited].map(index => active[index].a + '–' + active[index].b).join(', ') || 'ninguno'}.`,
      `Hay ${nodes.size} nodos y ${visited.size} enlaces alcanzables. ${cycle ? 'Hay ciclo.' : 'No hay ciclo.'}`,
    ],
  }
}

export function describeEthernetSwitch(profile: EthernetSwitchProfile, values: string[]): PredictionExercise {
  const item = profile.cases.find(candidate => candidate.label === values[0]) ?? profile.cases[0]
  switch (item.kind) {
    case 'fdb': return describeFdb(item)
    case 'timing': return describeTiming(item)
    case 'loop': return describeLoop(item)
  }
}
