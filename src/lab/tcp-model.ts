import type { PredictionAnswer, PredictionControl, PredictionExercise } from './prediction'

export const TCP_MODEL_VERSION = 'tcp-model-v1'

type Opening = { kind:'opening'; label:string; a:number; b:number; loss:'none'|'syn'|'syn-ack'|'final-ack' }
type Closing = { kind:'closing'; label:string; seq:number; bytes:number; event:'half'|'both'|'reset' }
type Segment = { offset:number; bytes:number; delivered:boolean }
type Receive = { kind:'receive'; label:string; base:number; segments:Segment[] }
type Recovery = { kind:'recovery'; label:string; base:number; bytes:number; duplicateAcks:number; expired:boolean }
type Window = { kind:'window'; label:string; inFlight:number; acknowledged:number; rwnd:number; cwnd:number }
type TcpCase = Opening | Closing | Receive | Recovery | Window
export type TcpProfile = { cases:TcpCase[] }

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const natural = (v: unknown, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max
const validLabel = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 80
  && v.trim() === v && !/[\r\n]/.test(v)
// The profile uses small contiguous sequence ranges and omits modular wraparound.
const seq = (v: unknown) => natural(v, 999_000_000)
const bytes = (v: unknown) => natural(v, 32768)

function segment(v: unknown): v is Segment {
  return record(v) && bytes(v.offset) && bytes(v.bytes) && v.bytes > 0
    && v.offset + v.bytes <= 32768 && typeof v.delivered === 'boolean'
}

function validCase(v: unknown): v is TcpCase {
  if (!record(v) || !validLabel(v.label)) return false
  switch (v.kind) {
    case 'opening':
      return seq(v.a) && seq(v.b) && typeof v.loss === 'string' && ['none','syn','syn-ack','final-ack'].includes(v.loss)
    case 'closing':
      return seq(v.seq) && bytes(v.bytes) && (v.event === 'half' || v.event === 'both' || (v.event === 'reset' && v.bytes === 0))
    case 'receive':
      return seq(v.base) && Array.isArray(v.segments) && v.segments.length > 0 && v.segments.length <= 8
        && v.segments.every(segment)
    case 'recovery':
      return seq(v.base) && bytes(v.bytes) && v.bytes > 0 && natural(v.duplicateAcks, 6)
        && typeof v.expired === 'boolean'
    case 'window':
      return natural(v.inFlight, 10_000_000) && natural(v.acknowledged, v.inFlight)
        && natural(v.rwnd, 10_000_000) && natural(v.cwnd, 10_000_000) && v.cwnd > 0
    default: return false
  }
}

export function validTcpProfile(v: unknown): v is TcpProfile {
  return record(v) && Array.isArray(v.cases) && v.cases.length > 0 && v.cases.length <= 10 && v.cases.every(validCase)
    && new Set(v.cases.map(c => c.label)).size === v.cases.length
}

export function tcpControls(profile: TcpProfile): PredictionControl[] {
  return [{ label:'Caso', options:profile.cases.map(c => c.label), initial:profile.cases[0].label }]
}

const number = (label: string, expected: number): PredictionAnswer => ({ label, expected:String(expected), format:'integer' })
const select = (label: string, expected: string, options: string[]): PredictionAnswer => ({ label, expected, options })

function opening(c: Opening): PredictionExercise {
  const finalLost = c.loss === 'final-ack'
  const stateB = finalLost ? 'SYN-RECEIVED' : 'ESTABLISHED'
  const loss = {
    none:'No se pierde ningún mensaje.',
    syn:'El primer SYN se pierde. A repite el mismo SYN, que llega.',
    'syn-ack':'El primer SYN+ACK se pierde. B repite la misma respuesta, que llega.',
    'final-ack':'El ACK final se pierde. Se observa antes de cualquier reintento o dato.',
  }[c.loss]
  return {
    facts:[`A abre con ISN ${c.a}. B escucha y responde con ISN ${c.b}. No hay datos durante la apertura.`, loss],
    answers:[
      number('SEQ del ACK final de A',c.a + 1),number('ACK final de A',c.b + 1),
      select('Estado final observado de B',stateB,['LISTEN','SYN-RECEIVED','ESTABLISHED']),
    ],
    steps:['Calcula lo que consume cada SYN. Distingue el ACK emitido por A del ACK recibido por B.'],
    trace:[
      `A inicia en SYN-SENT. B recibe SYN ${c.a} y pasa a SYN-RECEIVED. B responde con SYN+ACK ${c.b} y ACK ${c.a + 1}.`,
      `A recibe SYN+ACK, pasa a ESTABLISHED y emite SEQ ${c.a + 1}, ACK ${c.b + 1}.`,
      finalLost ? 'B aún no recibe la confirmación final y permanece en SYN-RECEIVED.' : 'B recibe la confirmación de su SYN y pasa a ESTABLISHED.',
    ],
  }
}

function closing(c: Closing): PredictionExercise {
  const reset = c.event === 'reset'
  const both = c.event === 'both'
  const ack = reset ? 0 : c.seq + c.bytes + 1
  const a = reset ? 'CLOSED' : both ? 'TIME-WAIT' : 'FIN-WAIT-2'
  const b = reset || both ? 'CLOSED' : 'CLOSE-WAIT'
  return {
    facts:['La conexión comienza en ESTABLISHED en ambos extremos. Los segmentos descritos se reciben en orden.',
      reset ? 'A aborta localmente y su RST es aceptado por B.'
        : `A envía ${c.bytes} octetos seguidos de FIN desde SEQ ${c.seq}. B confirma el FIN.`,
      ...(reset ? [] : [both ? 'Después, B cierra su mitad. Su FIN y el ACK de A también llegan.' : 'B todavía mantiene abierta su mitad de envío.'])],
    answers:[
      number('ACK de B al FIN de A (0 si no hay ACK)',ack),
      select('Estado final de A',a,['ESTABLISHED','FIN-WAIT-1','FIN-WAIT-2','TIME-WAIT','CLOSED']),
      select('Estado final de B',b,['ESTABLISHED','CLOSE-WAIT','LAST-ACK','CLOSED']),
    ],
    steps:['Cuenta el FIN como una posición de secuencia. Separa un cierre de una mitad, el intercambio completo y un aborto.'],
    trace: reset ? ['A aborta su conexión y pasa a CLOSED.', 'B acepta el RST y pasa a CLOSED sin enviar un ACK por él.'] : [
      `A envía el FIN y pasa a FIN-WAIT-1. B confirma con ACK ${ack} y queda en CLOSE-WAIT.`,
      'El ACK de B lleva a A a FIN-WAIT-2. B puede seguir enviando.',
      both ? 'B emite su FIN y pasa por LAST-ACK. A confirma y entra en TIME-WAIT. B recibe ese ACK y pasa a CLOSED.'
        : 'Sin FIN de B, A permanece en FIN-WAIT-2 y B en CLOSE-WAIT.',
    ],
  }
}

function receive(c: Receive): PredictionExercise {
  const received: Segment[] = []
  let next = 0
  const trace = c.segments.map((s,i) => {
    const start = c.base + s.offset
    if (!s.delivered) return `Fila ${i + 1}: se pierde el tramo desde ${start}. El siguiente esperado sigue en ${c.base + next}.`
    received.push(s)
    received.sort((a,b) => a.offset - b.offset)
    const old = next
    for (const part of received) {
      if (part.offset > next) break
      next = Math.max(next,part.offset + part.bytes)
    }
    return `Fila ${i + 1}: llegan ${s.bytes} octetos desde ${start}. Se liberan ${next - old} octetos nuevos en orden y el ACK acumulativo es ${c.base + next}.`
  })
  return {
    facts:[`El receptor espera ${c.base}. Guarda datos fuera de orden, descarta copias ya recibidas y confirma de forma inmediata.`,
      ...c.segments.map((s,i) => `Fila ${i + 1}: SEQ ${c.base + s.offset}, longitud ${s.bytes}, ${s.delivered ? 'llega' : 'se pierde'}.`)],
    answers:[number('Siguiente número esperado al final',c.base + next),number('Octetos nuevos entregados en orden',next)],
    steps:['Avanza solo por el tramo contiguo. Conserva los tramos que llegaron después de un hueco.'], trace,
  }
}

function recovery(c: Recovery): PredictionExercise {
  const trigger = c.duplicateAcks >= 3 ? 'Rápida' : c.expired ? 'Por RTO' : 'Sin retransmisión'
  const ack = trigger === 'Sin retransmisión' ? c.base : c.base + c.bytes * (1 + c.duplicateAcks)
  return {
    facts:[`Se pierde el tramo esperado desde SEQ ${c.base}. Cada tramo ocupa ${c.bytes} octetos.`,
      `Llegan y se guardan ${c.duplicateAcks} tramos posteriores contiguos entre sí. Cada uno produce un ACK duplicado apto antes del vencimiento.`,
      c.expired ? 'Si no se activa antes la retransmisión rápida, vence el RTO durante el corte.' : 'El RTO aún no vence en este corte.',
      'Si se retransmite el hueco, su copia llega. Perfil clásico sin SACK.'],
    answers:[select('Acción del emisor',trigger,['Rápida','Por RTO','Sin retransmisión']),
      number('Siguiente número esperado al final',ack)],
    steps:['Mientras falte el tramo esperado, conserva el mismo ACK. Identifica qué señal llega primero y recalcula al rellenar el hueco.'],
    trace:[
      `La pérdida deja el ACK acumulativo en ${c.base}, aunque haya tramos posteriores guardados.`,
      trigger === 'Rápida' ? 'El tercer ACK duplicado apto activa retransmisión rápida antes del vencimiento.'
        : trigger === 'Por RTO' ? 'No hubo tres ACK duplicados antes del vencimiento. Se retransmite por RTO.'
        : 'No hay umbral de tres ACK duplicados ni vencimiento. El hueco continúa.',
      `El siguiente esperado al final es ${ack}.`,
    ],
  }
}

function window(c: Window): PredictionExercise {
  const outstanding = c.inFlight - c.acknowledged
  const maxFlight = Math.min(c.rwnd,c.cwnd)
  const budget = Math.max(0,maxFlight - outstanding)
  const binding = c.rwnd < c.cwnd ? 'Receptor' : c.cwnd < c.rwnd ? 'Congestión' : 'Iguales'
  return {
    facts:[`Antes del ACK hay ${c.inFlight} octetos de datos en vuelo. El ACK confirma ${c.acknowledged} octetos nuevos.`,
      `Después del ACK, rwnd = ${c.rwnd}, cwnd = ${c.cwnd}. Valores en octetos, ya aplicadas las escalas pertinentes.`,
      'Presupuesto del instante sin recuperación, pacing ni otros límites.'],
    answers:[number('Octetos aún en vuelo',outstanding),number('Crédito para datos nuevos',budget),
      select('Ventana que fija el máximo en vuelo',binding,['Receptor','Congestión','Iguales'])],
    steps:['Primero actualiza los datos en vuelo. Después elige la menor ventana y calcula cuánto queda disponible.'],
    trace:[
      `Después del ACK quedan ${c.inFlight} − ${c.acknowledged} = ${outstanding} octetos en vuelo.`,
      `El máximo del perfil es min(${c.rwnd}, ${c.cwnd}) = ${maxFlight} octetos.`,
      `Crédito para datos nuevos: max(0, ${maxFlight} − ${outstanding}) = ${budget} octetos.`,
    ],
  }
}

export function describeTcp(profile: TcpProfile, values: string[]): PredictionExercise {
  const c = profile.cases.find(item => item.label === values[0]) ?? profile.cases[0]
  switch (c.kind) {
    case 'opening': return opening(c)
    case 'closing': return closing(c)
    case 'receive': return receive(c)
    case 'recovery': return recovery(c)
    case 'window': return window(c)
  }
}
