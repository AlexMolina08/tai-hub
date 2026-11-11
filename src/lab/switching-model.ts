import type { PredictionControl, PredictionExercise } from './prediction'

export const SWITCHING_MODEL_VERSION = 'switching-model-v1'

interface TimingCase {
  label: string
  payloadBits: number
  packets: number
  headerBits: number
  links: { bitsPerMs: number; propagationMs: number }[]
}

interface ReservationCase {
  label: string
  capacity: number
  alreadyReserved: number
  requests: number[]
}

export type SwitchingProfile =
  | { kind: 'timing'; cases: TimingCase[] }
  | { kind: 'reservation'; cases: ReservationCase[] }
  | { kind: 'delivery' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function whole(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function validTiming(value: Record<string, unknown>) {
  const { payloadBits, packets, headerBits, links } = value
  if (!whole(payloadBits, 1, 100_000) || !whole(packets, 2, 8) || payloadBits % packets !== 0
    || !whole(headerBits, 0, 8_000) || !Array.isArray(links) || !whole(links.length, 2, 4)) return false
  return links.every(link => isRecord(link) && whole(link.bitsPerMs, 1, 10_000)
    && whole(link.propagationMs, 0, 1000) && payloadBits % link.bitsPerMs === 0
    && (payloadBits / packets + headerBits) % link.bitsPerMs === 0)
}

function validReservation(value: Record<string, unknown>) {
  const { capacity, alreadyReserved, requests } = value
  return whole(capacity, 1, 100_000) && whole(alreadyReserved, 0, capacity)
    && Array.isArray(requests) && whole(requests.length, 2, 8)
    && requests.every(request => whole(request, 1, 100_000))
}

export function validSwitchingProfile(value: unknown): value is SwitchingProfile {
  if (!isRecord(value)) return false
  if (value.kind === 'delivery') return true
  if (value.kind !== 'timing' && value.kind !== 'reservation') return false
  if (!Array.isArray(value.cases) || !whole(value.cases.length, 2, 8)) return false
  const validCase = value.kind === 'timing' ? validTiming : validReservation
  return value.cases.every(item => isRecord(item) && typeof item.label === 'string'
    && item.label.trim() === item.label && whole(item.label.length, 1, 60) && validCase(item))
    && new Set(value.cases.map(item => item.label)).size === value.cases.length
}

function select(label: string, options: string[]): PredictionControl {
  return { label, options, initial: options[0] }
}

const message = 'Mensaje completo'
const packet = 'Paquetes'
const routed = 'Router IPv4'
const bridged = 'Una LAN lógica'
const noLoss = 'Sin pérdida declarada'
const loss = 'Pérdida en el enlace de C'

export function switchingControls(profile: SwitchingProfile): PredictionControl[] {
  if (profile.kind === 'delivery') return [
    select('Interconexión', [routed, bridged]), select('Estado de la transmisión', [noLoss, loss]),
  ]
  const variants = select('Caso', profile.cases.map(item => item.label))
  return profile.kind === 'timing' ? [variants, select('Unidad de reenvío', [message, packet])] : [variants]
}

function describeTiming(item: TimingCase, split: boolean): PredictionExercise {
  const count = split ? item.packets : 1
  const bits = split ? item.payloadBits / count + item.headerBits : item.payloadBits
  const arrival = Array<number>(count).fill(0)
  const trace: string[] = []
  for (const [hop, link] of item.links.entries()) {
    const duration = bits / link.bitsPerMs
    let freeAt = 0
    for (let unit = 0; unit < count; unit++) {
      const start = Math.max(freeAt, arrival[unit])
      freeAt = start + duration
      arrival[unit] = freeAt + link.propagationMs
      trace.push(`Enlace ${hop + 1}, unidad ${unit + 1}. Serialización de ${start} a ${freeAt} ms. Último bit en destino de este enlace a ${arrival[unit]} ms.`)
    }
  }
  return {
    facts: [
      `Hay ${item.payloadBits} bits útiles disponibles en t = 0. Se transmite un mensaje sin cabecera o ${item.packets} paquetes iguales con ${item.headerBits} bits de cabecera cada uno.`,
      ...item.links.map(({ bitsPerMs, propagationMs }, index) =>
        `Enlace ${index + 1}. Tasa ${bitsPerMs} kbit/s y propagación ${propagationMs} ms.`),
      'Cada salto reenvía al recibir la unidad completa y quedar libre el siguiente enlace. No hay tráfico ajeno ni tiempos de procesamiento.',
    ],
    answers: [
      { label: 'Bits transmitidos en el primer enlace', expected: String(count * bits), format: 'integer' },
      { label: 'Llegada de la primera unidad en ms', expected: String(arrival[0]), format: 'integer' },
      { label: 'Fin de la transferencia en ms', expected: String(arrival.at(-1)), format: 'integer' },
    ],
    steps: [`Se envían ${count} unidades de ${bits} bits. La propagación retrasa la llegada, pero el emisor puede serializar la siguiente unidad cuando acaba la anterior.`],
    trace,
  }
}

function describeReservation(item: ReservationCase): PredictionExercise {
  let free = item.capacity - item.alreadyReserved
  let decisions = ''
  const trace = item.requests.map((request, index) => {
    const accepted = request <= free
    if (accepted) free -= request
    decisions += accepted ? 'S' : 'N'
    return `Solicitud ${index + 1}: ${request} kbit/s. ${accepted ? 'Se admite.' : 'Se rechaza.'} Quedan ${free} kbit/s libres.`
  })
  return {
    facts: [
      `Capacidad total ${item.capacity} kbit/s. Capacidad ya reservada ${item.alreadyReserved} kbit/s.`,
      `Solicitudes en orden de llegada: ${item.requests.join(', ')} kbit/s.`,
      'Cada solicitud se decide una vez. No se liberan reservas, aunque los circuitos permanezcan en silencio.',
    ],
    answers: [
      { label: 'Decisiones en orden (S o N)', expected: decisions, format: 'sequence' },
      { label: 'Capacidad libre final en kbit/s', expected: String(free), format: 'integer' },
    ],
    steps: ['Una solicitud que supera la capacidad libre se rechaza sin consumir recursos. Una que ocupa exactamente la capacidad libre se admite.'],
    trace,
  }
}

function describeDelivery(values: string[]): PredictionExercise {
  const reachesRemoteLink = values[0] === bridged
  const reachesRemoteHost = reachesRemoteLink && values[1] === noLoss
  return {
    facts: [
      'A y B comparten la LAN de origen. C está al otro lado de la interconexión. A envía a 255.255.255.255 dentro de una trama de difusión.',
      'En una LAN lógica, el puente tiene salida elegible hacia C. Si la interconexión es un router IPv4, no hay puente ni relay. B recibe en todos los casos del modelo.',
    ],
    answers: [
      { label: '¿Sale una copia por el enlace de C?', expected: reachesRemoteLink ? 'Sí' : 'No', options: ['Sí', 'No'] },
      { label: '¿Qué otros equipos reciben?', expected: reachesRemoteHost ? 'B y C' : 'Solo B', options: ['Solo B', 'B y C'] },
    ],
    steps: ['El ámbito de difusión determina por dónde se reenvía. La pérdida de una copia afecta la recepción sin cambiar ese ámbito.'],
    trace: [
      'B recibe en la LAN de origen.',
      reachesRemoteLink ? 'El puente replica la trama en la misma LAN lógica hacia el enlace de C.'
        : 'El router IPv4 no reenvía el broadcast limitado.',
      reachesRemoteHost ? 'La copia llega a C en el caso sin pérdida.'
        : reachesRemoteLink ? 'La copia emitida se pierde antes de llegar a C.' : 'C no recibe porque no se emitió una copia hacia su enlace.',
    ],
  }
}

export function describeSwitching(profile: SwitchingProfile, values: string[]): PredictionExercise {
  switch (profile.kind) {
    case 'delivery': return describeDelivery(values)
    case 'timing': return describeTiming(profile.cases.find(item => item.label === values[0]) ?? profile.cases[0], values[1] === packet)
    case 'reservation': return describeReservation(profile.cases.find(item => item.label === values[0]) ?? profile.cases[0])
  }
}
