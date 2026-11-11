import type { PredictionAnswer, PredictionControl, PredictionExercise } from './prediction'

export const CONTENTION_MODEL_VERSION = 'contention-model-v1'

type Pair = [number, number]
type EthernetCase = { kind: 'ethernet'; label: string; duplex: 'shared' | 'full'; ready: Pair; retry?: Pair }
type WirelessCase = {
  kind: 'wireless'
  label: string
  hidden: boolean
  waits: Pair
  busySlots: number
  ackLost: boolean
} & ({ access: 'basic'; ctsAudible?: never } | { access: 'rts-cts'; ctsAudible: boolean })
type ContentionCase = EthernetCase | WirelessCase
export type ContentionProfile = { scenarios: ContentionCase[] }

const attempts = { collision: 'Colisión', a: 'A transmite primero', b: 'B transmite primero', full: 'Simultáneo sin colisión' }
const actions = {
  retryA: 'A reintenta primero', retryB: 'B reintenta primero', collide: 'Segunda colisión',
  deferA: 'A difiere por portadora', deferB: 'B difiere por portadora', full: 'Sin backoff de colisión',
}
const receptions = {
  a: 'Datos de A recibidos', b: 'Datos de B recibidos', dataCollision: 'Colisión de datos',
  rtsCollision: 'Colisión de RTS', mixedCollision: 'Solapamiento de datos y RTS',
}
const alternatives = { carrier: 'Espera por portadora', nav: 'Espera por NAV',
  simultaneous: 'Intento simultáneo', unprotected: 'Intenta sin protección' }
const confirmations = { confirmed: 'Confirmada', unconfirmed: 'Sin confirmar' }
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const label = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 80 && !/[\r\n]/.test(value)
const integer = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max
const pair = (value: unknown, max: number): value is Pair =>
  Array.isArray(value) && value.length === 2 && integer(value[0], max) && integer(value[1], max)

function validCase(row: unknown): row is ContentionCase {
  if (!record(row) || !label(row.label)) return false
  if (row.kind === 'ethernet') {
    if ((row.duplex !== 'shared' && row.duplex !== 'full') || !pair(row.ready, 1)) return false
    const collision = row.duplex === 'shared' && row.ready[0] === row.ready[1]
    return collision ? pair(row.retry, 1) : row.retry === undefined
  }
  if (row.kind !== 'wireless' || !pair(row.waits, 3) || !integer(row.busySlots, 4)
    || typeof row.hidden !== 'boolean' || typeof row.ackLost !== 'boolean') return false
  return (row.access === 'basic' && row.ctsAudible === undefined)
    || (row.access === 'rts-cts' && typeof row.ctsAudible === 'boolean')
}

export function validContentionProfile(value: unknown): value is ContentionProfile {
  return record(value) && Array.isArray(value.scenarios) && value.scenarios.length >= 2 && value.scenarios.length <= 12
    && value.scenarios.every(validCase) && new Set(value.scenarios.map(row => row.label)).size === value.scenarios.length
}

export function contentionControls(profile: ContentionProfile): PredictionControl[] {
  const options = profile.scenarios.map(row => row.label)
  return [{ label: 'Caso de acceso al medio', options, initial: options[0] }]
}

function answer<K extends string>(label: string, values: Record<K, string>, choice: K): PredictionAnswer {
  return { label, options: Object.values<string>(values), expected: values[choice] }
}
const order = ([a, b]: Pair) => a === b ? 'empate' : a < b ? 'A' : 'B'
const other = (station: 'A' | 'B') => station === 'A' ? 'B' : 'A'

function describeEthernet(row: EthernetCase): PredictionExercise {
  const first = order(row.ready)
  const facts = [
    row.duplex === 'shared' ? 'Dos estaciones sobre un segmento Ethernet semidúplex compartido.'
      : 'Enlace Ethernet punto a punto full dúplex. A y B transmiten en sentidos opuestos.',
    `A tiene una trama lista en el instante ${row.ready[0]} y B en el ${row.ready[1]}.`,
  ]
  const trace: string[] = []
  let result: keyof typeof attempts
  let action: keyof typeof actions
  if (row.retry) {
    const next = order(row.retry)
    facts.push(`Tras una colisión, el primer sorteo es A = ${row.retry[0]} y B = ${row.retry[1]} ranuras.`)
    trace.push('A y B observan el medio libre y empiezan a la vez. Ambas detectan colisión y abortan.')
    trace.push(`Primer backoff: cada estación elige entre 0 y 1 ranuras. A elige ${row.retry[0]} y B elige ${row.retry[1]}.`)
    trace.push(next === 'empate'
      ? 'El primer reintento coincide y se produce otra colisión. El siguiente sorteo usa de 0 a 3 ranuras.'
      : `${next} reintenta antes. La otra estación debe escuchar el medio antes de transmitir.`)
    result = 'collision'
    action = next === 'empate' ? 'collide' : next === 'A' ? 'retryA' : 'retryB'
  } else if (row.duplex === 'full') {
    trace.push(first === 'empate' ? 'Los dos sentidos operan simultáneamente y no compiten por un medio compartido.'
      : `${first} tiene una trama lista antes. El sentido contrario puede enviar cuando la tenga lista.`)
    trace.push('En full dúplex no intervienen detección de colisión ni backoff de CSMA/CD.')
    result = first === 'empate' ? 'full' : first === 'A' ? 'a' : 'b'
    action = 'full'
  } else {
    const later = first === 'A' ? 'B' : 'A'
    trace.push(`${first} inicia la transmisión cuando el medio está libre.`)
    trace.push(`${later} detecta portadora antes de intentar enviar y espera hasta que el medio vuelva a estar libre.`)
    result = first === 'A' ? 'a' : 'b'
    action = first === 'A' ? 'deferB' : 'deferA'
  }
  return {
    facts, trace,
    answers: [answer('Resultado del primer intento', attempts, result), answer('Acción a continuación', actions, action)],
    steps: ['El modelo termina tras la primera ronda de reintento o espera. Los instantes son abstractos.'],
  }
}

function describeWireless(row: WirelessCase): PredictionExercise {
  const first = order(row.waits)
  const protectedAccess = row.access === 'rts-cts'
  const facts = [
    'Wi-Fi DCF con tramas unicast. A y B envían hacia el mismo receptor.',
    row.hidden ? 'A y B no se oyen entre sí. Las dos alcanzan el receptor.'
      : 'A y B perciben la portadora de la otra estación.',
    `Ocupación inicial: ${row.busySlots} ranuras. Contadores iniciales: A = ${row.waits[0]} y B = ${row.waits[1]}.`,
    protectedAccess ? `Se usa RTS/CTS. Si el receptor emite CTS, la otra estación ${row.ctsAudible ? 'puede' : 'no puede'} decodificarlo.`
      : 'Se usa acceso básico con DATA y ACK.',
    row.ackLost ? 'El perfil pierde el ACK de una recepción de datos correcta.' : 'Si se emite ACK, el emisor lo recibe.',
  ]
  if (row.hidden) {
    facts.push('Un segundo intento no inhibido se solapa con los datos. Si los contadores difieren, el primer RTS y su CTS ya ocurrieron antes de ese intento en el perfil.')
  }
  const trace = [
    row.busySlots ? `Durante las ${row.busySlots} ranuras ocupadas, los contadores conservan sus valores. Reanudan en el tramo libre del modelo.`
      : 'El medio empieza libre. Las estaciones cuentan ranuras hasta su primera oportunidad.',
  ]
  let reception: keyof typeof receptions
  let second: keyof typeof alternatives
  let confirmed = false
  if (first === 'empate') {
    trace.push(protectedAccess ? 'Ambos contadores se agotan a la vez y los RTS coinciden en el receptor. No se emite CTS.'
      : 'Ambos contadores se agotan a la vez y las dos transmisiones de datos se solapan en el receptor.')
    trace.push('No se completa un envío de datos y no se recibe su ACK.')
    reception = protectedAccess ? 'rtsCollision' : 'dataCollision'
    second = 'simultaneous'
  } else if (row.hidden && !(row.access === 'rts-cts' && row.ctsAudible)) {
    trace.push(`${first} agota antes su contador. ${other(first)} no percibe su portadora ni una reserva aplicable.`)
    trace.push(protectedAccess ? 'El receptor contesta al primer RTS, pero la otra estación no decodifica el CTS. Su RTS se solapa con los primeros datos.'
      : 'Las dos transmisiones de datos se solapan en el receptor.')
    trace.push('El envío de datos de interés queda sin confirmar.')
    reception = protectedAccess ? 'mixedCollision' : 'dataCollision'
    second = 'unprotected'
  } else {
    trace.push(`${first} agota su contador antes que ${other(first)}.`)
    trace.push(row.hidden ? `${other(first)} decodifica el CTS del receptor y difiere por NAV.`
      : `${other(first)} percibe ocupación y difiere por portadora.`)
    trace.push(`Se reciben los datos de ${first}. ${row.ackLost ? 'El ACK se pierde y el emisor no puede confirmarlos.'
      : 'El emisor recibe ACK y confirma el intercambio.'}`)
    reception = first === 'A' ? 'a' : 'b'
    second = row.hidden ? 'nav' : 'carrier'
    confirmed = !row.ackLost
  }
  return {
    facts, trace,
    answers: [answer('Resultado en el receptor', receptions, reception), answer('Acción de la otra estación', alternatives, second),
      answer('Confirmación observada por el emisor', confirmations, confirmed ? 'confirmed' : 'unconfirmed')],
    steps: ['Se observa una transacción, con ventanas abstractas que se solapan si ambas estaciones intentan acceder. No se simula la temporización PHY.'],
  }
}

export function describeContention(profile: ContentionProfile, values: string[]): PredictionExercise {
  const row = profile.scenarios.find(scenario => scenario.label === values[0]) ?? profile.scenarios[0]
  return row.kind === 'ethernet' ? describeEthernet(row) : describeWireless(row)
}
