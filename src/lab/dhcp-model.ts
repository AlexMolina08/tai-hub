import type { PredictionControl, PredictionExercise } from './prediction'

export const DHCP_MODEL_VERSION = 'dhcp-model-v1'

type StartupOutcome = 'direct' | 'relayed' | 'no-relay' | 'ack-not-delivered' | 'reboot-nak'
type LeaseOutcome = 'renew' | 'rebind' | 'expire'
type DhcpScenario = { label: string } & (
  { kind: 'startup'; outcome: StartupOutcome }
  | { kind: 'lease'; outcome: LeaseOutcome; duration: number; t1?: number; t2?: number }
)
export type DhcpProfile = { scenarios: DhcpScenario[] }

const startupOutcomes = ['direct', 'relayed', 'no-relay', 'ack-not-delivered', 'reboot-nak'] as const
const leaseOutcomes = ['renew', 'rebind', 'expire'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isScenario(value: unknown): value is DhcpScenario {
  if (!isRecord(value) || typeof value.label !== 'string' || !value.label
    || value.label.length > 60 || value.label.trim() !== value.label) return false
  if (value.kind === 'startup') return startupOutcomes.some(outcome => outcome === value.outcome)
  if (value.kind !== 'lease' || !leaseOutcomes.some(outcome => outcome === value.outcome)) return false
  const { duration, t1, t2 } = value
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 8 || duration > 604800) return false
  const renewal = t1 === undefined ? duration / 2 : t1
  const rebinding = t2 === undefined ? duration * 7 / 8 : t2
  return typeof renewal === 'number' && typeof rebinding === 'number'
    && Number.isInteger(renewal) && Number.isInteger(rebinding) && 0 < renewal && renewal < rebinding && rebinding < duration
}

export function validDhcpProfile(value: unknown): value is DhcpProfile {
  if (!isRecord(value) || !Array.isArray(value.scenarios) || value.scenarios.length < 2
    || value.scenarios.length > 12 || !value.scenarios.every(isScenario)) return false
  return new Set(value.scenarios.map(scenario => scenario.label)).size === value.scenarios.length
}

export function dhcpControls(profile: DhcpProfile): PredictionControl[] {
  return [{ label: 'Escenario preparado', options: profile.scenarios.map(scenario => scenario.label), initial: profile.scenarios[0].label }]
}

const broadcast = '255.255.255.255'
const relay = '192.0.2.5'
const remote = '198.51.100.20'
const peer = '198.51.100.21'
const local = '192.0.2.2'
const leased = '192.0.2.41'
const choice = (label: string, expected: string, options: string[]) => ({ label, expected, options })
const usable = (available: boolean) => choice('Dirección utilizable al final del registro', available ? 'Sí' : 'No', ['Sí', 'No'])

function startup(outcome: StartupOutcome): PredictionExercise {
  const relayed = outcome === 'relayed' || outcome === 'ack-not-delivered'
  const server = relayed ? remote : local
  const bound = outcome === 'direct' || outcome === 'relayed'
  const reboot = outcome === 'reboot-nak'
  const unserved = outcome === 'no-relay'
  const state = bound ? 'BOUND' : reboot ? 'INIT' : unserved ? 'SELECTING sin oferta' : 'REQUESTING sin confirmación'
  const facts = reboot ? ['El cliente recuerda 198.51.100.41 tras reiniciar en otra LAN.', 'Recibe un DHCPNAK válido.']
    : unserved ? ['El cliente carece de IP y de concesión previa. El servidor está en otra subred y no hay agente en la LAN.']
    : relayed ? [`Servidor remoto ${remote}. Interfaz del agente en la LAN del cliente ${relay}.`,
      outcome === 'ack-not-delivered' ? 'El agente recibe el ACK en el enlace remoto. La sonda no lo ve en la LAN del cliente y el cliente tampoco lo recibe.'
        : 'El servidor confirma la solicitud y el agente entrega la respuesta al cliente.']
    : [`Cliente sin IP y servidor ${local} en la misma LAN. Se completa el intercambio sin pérdidas.`]
  const trace: string[] = []
  function request(type: string, fields = '') {
    trace.push(`LAN cliente · ${type}. 0.0.0.0:68 → ${broadcast}:67.${fields}`)
    if (relayed) trace.push(`Relay → servidor · ${type}. En el perfil, ${relay}:67 → ${remote}:67. giaddr=${relay}, hops=1.${fields}`)
  }
  function reply(type: string, delivered: boolean) {
    if (relayed) trace.push(`Servidor → relay · ${type}. ${remote}:67 → ${relay}:67. giaddr=${relay}.`)
    trace.push(delivered ? `LAN cliente · ${type}. ${relayed ? 'El agente entrega' : `El servidor ${server} entrega`} el mensaje a ${broadcast}:68.`
      : 'LAN cliente · El ACK no llega al cliente.')
  }
  if (reboot) {
    request('DHCPREQUEST', ' INIT-REBOOT. Solicita validar 198.51.100.41.')
    reply('DHCPNAK', true)
    trace.push('El cliente descarta la dirección anterior y vuelve a INIT.')
  } else {
    request('DHCPDISCOVER')
    if (unserved) trace.push('Sin OFFER. La difusión de la LAN no alcanza por sí sola al servidor remoto.')
    else {
      reply('DHCPOFFER', true)
      request('DHCPREQUEST', ` Selecciona el servidor ${server} y solicita ${leased}.`)
      reply('DHCPACK', bound)
    }
  }
  const answers = [
    usable(bound),
    choice('Resultado de arranque', state, ['BOUND', 'INIT', 'SELECTING sin oferta', 'REQUESTING sin confirmación']),
  ]
  if (relayed) answers.push(choice('Destino del servidor hacia el relay', `${relay}:67`, [`${relay}:67`, `${relay}:68`, `${broadcast}:68`]))
  return {
    facts, answers, trace,
    steps: ['Una oferta no basta para usar la dirección. Cuenta el resultado que recibe el cliente.', `Estado final del caso: ${state}.`],
  }
}

function lease(scenario: Extract<DhcpScenario, { kind: 'lease' }>): PredictionExercise {
  const { duration, outcome, t1 = duration / 2, t2 = duration * 7 / 8 } = scenario
  const state = outcome === 'renew' ? 'BOUND por renovación' : outcome === 'rebind' ? 'BOUND por revinculación' : 'INIT por caducidad'
  const facts = [
    `Duración inicial ${duration} s. Servidor original ${remote}. El cliente usa ${leased}.`,
    scenario.t1 === undefined ? 'Opción 58 ausente.' : `Opción 58: ${t1} s.`,
    scenario.t2 === undefined ? 'Opción 59 ausente.' : `Opción 59: ${t2} s.`,
    outcome === 'renew' ? 'El servidor original confirma al primer intento.'
      : outcome === 'rebind' ? `El original no responde. Otro servidor con autoridad (${peer}) confirma al primer intento de revinculación.`
        : 'Ningún servidor responde a los intentos de mantenimiento.',
  ]
  const trace = [
    `t=0 · BOUND. La concesión inicial vence en t=${duration}.`,
    `t=${t1} · RENEWING. DHCPREQUEST unicast de ${leased}:68 a ${remote}:67. ciaddr=${leased}.`,
  ]
  if (outcome !== 'renew') trace.push(`t=${t2} · REBINDING. DHCPREQUEST broadcast de ${leased}:68 a ${broadcast}:67. ciaddr=${leased}.`)
  trace.push(outcome === 'expire' ? `t=${duration} · Caduca sin confirmación. El cliente deja de usar la dirección y vuelve a INIT.`
    : `t=${outcome === 'renew' ? t1 : t2} · DHCPACK de ${outcome === 'renew' ? remote : peer}:67 a ${leased}:68.`)
  return {
    facts, trace,
    answers: [
      usable(outcome !== 'expire'),
      { label: 'T1 desde el comienzo, en segundos', expected: String(t1), format: 'integer' },
      { label: 'T2 desde el comienzo, en segundos', expected: String(t2), format: 'integer' },
      choice('Destino del primer DHCPREQUEST', `${remote}:67`, [`${remote}:67`, `${peer}:67`, `${broadcast}:67`, `${remote}:68`]),
      choice('Estado final de la concesión', state, ['BOUND por renovación', 'BOUND por revinculación', 'INIT por caducidad']),
    ],
    steps: ['El modelo omite dispersión y retransmisiones. T1 y T2 se cuentan desde el inicio de la concesión.', `Estado final del caso: ${state}.`],
  }
}

export function describeDhcp(profile: DhcpProfile, values: string[]): PredictionExercise {
  const scenario = profile.scenarios.find(item => item.label === values[0]) ?? profile.scenarios[0]
  return scenario.kind === 'startup' ? startup(scenario.outcome) : lease(scenario)
}
