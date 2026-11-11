export const SIGNAL_MODEL_VERSION = 'signal-model-v1'

type Transmission = {
  kind: 'transmission'; signal: 'continuous' | 'discrete'; lanes: number; timing: 'shared' | 'frame';
  direction: 'one-way' | 'alternate' | 'simultaneous'; nodes: number
}
type Rate = { kind: 'rate'; symbolsPerSecond: number; levels: number; payloadBytes: number; frameBytes: number }
type Limits = { kind: 'limits'; bandwidthHz: number; levels: number; snrDb: number }
type Latency = { kind: 'latency'; frameBytes: number; rateKbps: number; distanceKm: number; speedKmPerSecond: number; queueMs: number }
type Power = { kind: 'power'; inputMw: number; outputMw: number; noiseMw: number }

export type SignalCase = { id: string; title: string } & (Transmission | Rate | Limits | Latency | Power)

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function bounded(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high
}
function integer(value: unknown, low: number, high: number): value is number {
  return bounded(value, low, high) && Number.isInteger(value)
}
function levels(value: unknown): value is number {
  return integer(value, 2, 1024) && Number.isInteger(Math.log2(value))
}
function label(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 100
}
function isSignalCase(value: unknown): value is SignalCase {
  if (!record(value) || !label(value.id) || !label(value.title)) return false
  switch (value.kind) {
    case 'transmission': return (value.signal === 'continuous' || value.signal === 'discrete') && integer(value.lanes, 1, 16)
      && (value.timing === 'shared' || value.timing === 'frame') && integer(value.nodes, 2, 16)
      && (value.direction === 'one-way' || value.direction === 'alternate' || value.direction === 'simultaneous')
    case 'rate': return integer(value.symbolsPerSecond, 1, 1e8) && levels(value.levels)
      && integer(value.frameBytes, 1, 1e6) && integer(value.payloadBytes, 0, value.frameBytes)
    case 'limits': return integer(value.bandwidthHz, 1, 1e8) && levels(value.levels) && bounded(value.snrDb, -30, 80)
    case 'latency': return integer(value.frameBytes, 1, 1e6) && bounded(value.rateKbps, 1, 1e8)
      && bounded(value.distanceKm, 0, 1e6) && bounded(value.speedKmPerSecond, 1, 300_000) && bounded(value.queueMs, 0, 1e6)
    case 'power': return bounded(value.inputMw, 1e-9, 1e6) && bounded(value.outputMw, 1e-9, value.inputMw)
      && bounded(value.noiseMw, 1e-9, 1e6)
    default: return false
  }
}

export function validSignalCases(value: unknown): value is SignalCase[] {
  return Array.isArray(value) && value.length === 2 && value.every(isSignalCase)
    && value[0].id !== value[1].id && value[0].title !== value[1].title && value[0].kind === value[1].kind
    && JSON.stringify(describeSignalCase(value[0]).facts) !== JSON.stringify(describeSignalCase(value[1]).facts)
}

interface SignalField {
  label: string
  expected: string
  explanation: string
  options?: readonly string[]
  value?: number
}
const numberLabel = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 9 })
const roundedLabel = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, useGrouping: false })
const decimal = /^-?\d+(?:[.,]\d{1,2})?$/
function quantity(value: number, unit: string) { return `${numberLabel.format(value)} ${unit}` }
function numeric(label: string, value: number, explanation: string): SignalField {
  return { label, expected: roundedLabel.format(value), value, explanation }
}
function choice(label: string, options: readonly string[], index: number, explanation: string): SignalField {
  return { label, options, expected: options[index], explanation }
}

export function describeSignalCase(value: SignalCase): { facts: string[]; fields: SignalField[] } {
  switch (value.kind) {
    case 'transmission': {
      const directions = {
        'one-way': 'Solo un extremo puede enviar.',
        alternate: 'Ambos extremos pueden enviar por turnos.',
        simultaneous: 'Ambos extremos pueden enviar a la vez.',
      }
      return {
        facts: [value.signal === 'continuous' ? 'El receptor mide cualquier valor de amplitud dentro de un intervalo.'
          : 'El receptor distingue un conjunto finito de niveles de amplitud.',
        value.lanes === 1 ? 'Se transmite un elemento tras otro por una vía.' : `Se transmiten ${value.lanes} elementos a la vez por vías separadas.`,
        value.timing === 'shared' ? 'El emisor y el receptor comparten una referencia continua para temporizar los elementos transmitidos.'
          : 'El receptor se sincroniza con los bits de inicio de cada carácter. Los caracteres pueden quedar separados por pausas.',
        directions[value.direction], `El enlace conecta ${value.nodes} estaciones.`],
        fields: [
          choice('Señal', ['Analógica', 'Digital'], value.signal === 'continuous' ? 0 : 1, 'Observa si la amplitud admite valores continuos o niveles discretos.'),
          choice('Transferencia', ['Serie', 'Paralelo'], value.lanes === 1 ? 0 : 1, 'Clasifica cuántos bits avanzan a la vez.'),
          choice('Temporización', ['Síncrona', 'Asíncrona'], value.timing === 'shared' ? 0 : 1, 'Distingue referencia continua y sincronización por carácter.'),
          choice('Sentido', ['Simplex', 'Half dúplex', 'Full dúplex'], ['one-way', 'alternate', 'simultaneous'].indexOf(value.direction),
            'Cuenta sentidos permitidos y comprueba si coinciden en el tiempo.'),
          choice('Extremos', ['Punto a punto', 'Multipunto'], value.nodes === 2 ? 0 : 1, 'El número de estaciones del enlace fija esta clasificación.'),
        ],
      }
    }
    case 'rate': {
      const bitsPerSymbol = Math.log2(value.levels)
      const gross = value.symbolsPerSecond * bitsPerSymbol / 1000
      return {
        facts: [quantity(value.symbolsPerSecond, 'Bd'), quantity(value.levels, 'niveles equiprobables por símbolo'),
          quantity(value.payloadBytes, 'bytes útiles por trama'), quantity(value.frameBytes, 'bytes totales por trama'),
          'Código fijo por símbolo, sin pausas ni retransmisiones.'],
        fields: [
          numeric('Bits por símbolo', bitsPerSymbol, 'Calcula log₂ de la cantidad de niveles.'),
          numeric('Tasa bruta (kbit/s)', gross, 'Multiplica los baudios por bits/símbolo y divide por 1000.'),
          numeric('Tasa útil (kbit/s)', gross * value.payloadBytes / value.frameBytes, 'Multiplica la tasa bruta por la fracción útil de cada trama.'),
        ],
      }
    }
    case 'limits': {
      const snr = 10 ** (value.snrDb / 10)
      return {
        facts: [quantity(value.bandwidthHz, 'Hz de ancho de banda'), quantity(value.levels, 'niveles por símbolo'),
          quantity(value.snrDb, 'dB de relación señal/ruido'), 'Nyquist para el modelo ideal sin interferencia entre símbolos. Shannon para el canal con ruido blanco gaussiano aditivo.'],
        fields: [
          numeric('Cota de Nyquist (kbit/s)', 2 * value.bandwidthHz * Math.log2(value.levels) / 1000, 'Usa 2·B·log₂(M) y convierte a kbit/s.'),
          numeric('Capacidad de Shannon (kbit/s)', value.bandwidthHz * Math.log2(1 + snr) / 1000, 'Convierte dB a razón lineal con 10^(dB/10). Usa B·log₂(1+S/R).'),
        ],
      }
    }
    case 'latency': {
      const serialization = value.frameBytes * 8 / value.rateKbps
      const propagation = value.distanceKm / value.speedKmPerSecond * 1000
      return {
        facts: [quantity(value.frameBytes, 'bytes de trama'), quantity(value.rateKbps, 'kbit/s de tasa del enlace'),
          quantity(value.distanceKm, 'km de recorrido'), quantity(value.speedKmPerSecond, 'km/s de propagación'),
          quantity(value.queueMs, 'ms de espera en cola'), 'Un enlace, un sentido y procesamiento despreciable.'],
        fields: [
          numeric('Serialización (ms)', serialization, 'Divide bits de trama entre bits/s y convierte a ms.'),
          numeric('Propagación (ms)', propagation, 'Divide distancia entre velocidad y convierte a ms.'),
          numeric('Retardo total (ms)', serialization + propagation + value.queueMs, 'Suma serialización, propagación y cola antes de redondear.'),
        ],
      }
    }
    case 'power': return {
      facts: [quantity(value.inputMw, 'mW de señal antes del tramo'), quantity(value.outputMw, 'mW de señal a la salida'),
        quantity(value.noiseMw, 'mW de ruido a la salida')],
      fields: [
        numeric('Atenuación (dB)', 10 * Math.log10(value.inputMw / value.outputMw), 'Para potencias, calcula 10·log₁₀(Pentrada/Psalida).'),
        numeric('Relación señal/ruido a la salida (dB)', 10 * Math.log10(value.outputMw / value.noiseMw), 'Compara potencia de señal y potencia de ruido en el mismo punto.'),
      ],
    }
  }
}

export function parseSignalAnswers(raw: string, cases: SignalCase[]): string[][] {
  let decoded: unknown
  try { decoded = JSON.parse(raw) } catch { decoded = null }
  return cases.map((item, index) => {
    const entries: unknown = Array.isArray(decoded) ? decoded[index] : null
    return describeSignalCase(item).fields.map((_, fieldIndex) => {
      const answer: unknown = Array.isArray(entries) ? entries[fieldIndex] : null
      return typeof answer === 'string' && answer.length <= 40 ? answer : ''
    })
  })
}

export function signalAnswerMatches(field: SignalField, answer: string): boolean {
  if (field.value === undefined) return answer === field.expected
  const text = answer.trim()
  // Half a unit in the last decimal permits both nearest values at an exact tie.
  const tolerance = 0.005 + Number.EPSILON * Math.max(1, Math.abs(field.value))
  return decimal.test(text) && Math.abs(Number(text.replace(',', '.')) - field.value) <= tolerance
}

export function signalAnswersComplete(cases: SignalCase[], answers: string[][]): boolean {
  return cases.every((item, index) => describeSignalCase(item).fields.every((field, fieldIndex) => {
    const answer = answers[index]?.[fieldIndex] ?? ''
    return field.options ? field.options.includes(answer) : decimal.test(answer.trim())
  }))
}
