export const FRAME_MODEL_VERSION = 'frame-model-v1'

type Vector = { title: string; bytes: number[] }
type FrameSize = { frameBits: number; payloadBits: number; ackBits: number }
export type FrameProfile =
  | { kind: 'constellation' }
  | { kind: 'slots'; symbols: string[]; owners: ('A' | 'B')[] }
  | { kind: 'correlation'; chips: [number, number] }
  | { kind: 'parity'; bits: string }
  | { kind: 'checksum' | 'fcs'; vectors: Vector[] }
  | { kind: 'xor'; symbols: [number, number, number] }
  | { kind: 'arq'; sizes: FrameSize[] }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const integer = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const byte = (v: unknown) => integer(v, 0, 255)
export function validFrameProfile(v: unknown): v is FrameProfile {
  if (!isRecord(v)) return false
  switch (v.kind) {
    case 'constellation': return true
    case 'slots': return Array.isArray(v.symbols) && [4, 8].includes(v.symbols.length)
      && v.symbols.every(s => typeof s === 'string' && /^[A-Z0-9]$/.test(s))
      && Array.isArray(v.owners) && v.owners.length === v.symbols.length && v.owners.every(o => o === 'A' || o === 'B')
    case 'correlation': return Array.isArray(v.chips) && v.chips.length === 2 && v.chips.every(c => integer(c, -16, 16))
    case 'parity': return typeof v.bits === 'string' && /^[01]{8}$/.test(v.bits)
    case 'checksum':
    case 'fcs': return Array.isArray(v.vectors) && v.vectors.length >= 2 && v.vectors.length <= 4
      && v.vectors.every(x => isRecord(x) && typeof x.title === 'string' && !!x.title.trim() && x.title.length <= 60
        && Array.isArray(x.bytes) && x.bytes.length >= 1 && x.bytes.length <= 16 && x.bytes.every(byte))
      && new Set(v.vectors.map(x => x.title)).size === v.vectors.length
    case 'xor': return Array.isArray(v.symbols) && v.symbols.length === 3 && v.symbols.every(byte)
    case 'arq': return Array.isArray(v.sizes) && v.sizes.length >= 2 && v.sizes.length <= 4
      && v.sizes.every(x => isRecord(x) && integer(x.frameBits, 1, 100_000)
        && integer(x.payloadBits, 1, x.frameBits) && integer(x.ackBits, 1, 100_000))
      && new Set(v.sizes.map(x => x.frameBits)).size === v.sizes.length
    default: return false
  }
}

type Control = { label: string; options: string[]; initial: string; toggle?: true }
type Answer = { label: string; expected: string; options?: string[]; format?: 'sequence' | 'hex' | 'hex-or-dash' | 'integer' | 'fraction' }
const yesNo = ['Sí', 'No']
const yes = (b: boolean) => b ? yesNo[0] : yesNo[1]
const options = (label: string, values: string[], initial = values[0]): Control => ({ label, options: values, initial })
const toggle = (label: string): Control => ({ label, options: ['0', '1'], initial: '0', toggle: true })
const levels = ['-3', '-1', '1', '3']
const hex = (value: number, length: number) => value.toString(16).toUpperCase().padStart(length, '0')
const bytesText = (bytes: number[]) => bytes.map(n => hex(n, 2)).join(' ')

export function frameControls(profile: FrameProfile): Control[] {
  switch (profile.kind) {
    case 'constellation': return [options('I del punto A', levels, '1'), options('Q del punto A', levels, '3'),
      options('I del punto B', levels, '3'), options('Q del punto B', levels, '1')]
    case 'slots': return profile.symbols.map((s, i) => options(`Flujo de ranura ${i + 1} · ${s}`, ['A', 'B'], profile.owners[i]))
    case 'correlation': return [options('Par de códigos', ['(+,+) y (+,−)', '(+,+) y (+,+)'])]
    case 'parity': return [options('Tipo de paridad', ['Par', 'Impar']),
      ...Array.from({ length: profile.bits.length + 1 }, (_, i) => toggle(i === profile.bits.length ? 'Invertir bit de paridad' : `Invertir bit ${i + 1}`))]
    case 'checksum':
    case 'fcs': return [options('Vector de octetos', profile.vectors.map(v => v.title)),
      options('Alteración', ['Sin cambio', 'Invertir el bit menos significativo del primer octeto'])]
    case 'xor': return [options('Pérdida señalada', ['Ninguna', 'Símbolo A', 'Símbolo B', 'Símbolo C', 'Símbolos A y B'])]
    case 'arq': return [options('Tamaño de trama', profile.sizes.map(v => `${v.frameBits} bits`)),
      options('Primer envío de A', ['Trama recibida y ACK recibido', 'Trama perdida', 'Trama recibida y ACK perdido'])]
  }
}

type FrameDescription = { facts: string[]; answers: Answer[]; steps: string[]; points?: [number, number][] }
function closed(label: string, expected: string, options: string[] = yesNo): Answer { return { label, expected, options } }
function exact(label: string, value: string | number, format: NonNullable<Answer['format']>): Answer {
  return { label, expected: String(value), format }
}
function fcs(bytes: number[]): number {
  let remainder = 0xffff
  for (const byte of bytes) {
    remainder ^= byte
    for (let i = 0; i < 8; i++) remainder = (remainder >>> 1) ^ ((remainder & 1) ? 0x8408 : 0)
  }
  return remainder
}
export function describeFrame(profile: FrameProfile, values: string[]): FrameDescription {
  switch (profile.kind) {
    case 'constellation': {
      const [i1, q1, i2, q2] = values.map(Number)
      const first = i1 * i1 + q1 * q1
      const second = i2 * i2 + q2 * q2
      return {
        facts: ['Constelación ideal. Las coordenadas indican amplitudes en fase y cuadratura.'],
        answers: [closed('¿Coinciden las magnitudes?', yes(first === second)), closed('¿Es el mismo punto?', yes(i1 === i2 && q1 === q2))],
        steps: [`A (${i1}, ${q1}) y B (${i2}, ${q2}).`, `I² + Q² vale ${first} en A y ${second} en B. Para coincidir como punto deben coincidir ambas coordenadas.`],
        points: [[i1, q1], [i2, q2]],
      }
    }
    case 'slots': {
      const payload = (owner: string) => profile.symbols.filter((_, i) => values[i] === owner).join('') || '-'
      return {
        facts: [`Secuencia recibida: ${profile.symbols.join(' ')}. Se conserva la alineación de la trama.`,
          'Escribe los símbolos de cada flujo en orden. Usa un guion si un flujo queda vacío.'],
        answers: [exact('Carga de A', payload('A'), 'sequence'), exact('Carga de B', payload('B'), 'sequence')],
        steps: [`Asignación por ranura: ${profile.symbols.map((s, i) => `${i + 1}→${values[i]} (${s})`).join(', ')}.`,
          'Cada receptor conserva el orden de las posiciones asignadas a su flujo.'],
      }
    }
    case 'correlation': {
      const [x, y] = profile.chips
      const separate = values[0] === '(+,+) y (+,−)'
      const dots = [x + y, separate ? x - y : x + y]
      const signs = ['Positiva', 'Nula', 'Negativa', 'No separable']
      const sign = (value: number) => !separate ? signs[3] : value > 0 ? signs[0] : value < 0 ? signs[2] : signs[1]
      return {
        facts: [`Chips recibidos: (${x}, ${y}). Cada código tiene dos chips de amplitud +1 o −1.`],
        answers: [closed('¿Permiten separar las contribuciones?', yes(separate)), ...dots.map((v, i) =>
          closed(`Contribución ${i + 1}`, sign(v), signs))],
        steps: [`Productos escalares: ${dots.join(' y ')}.`, separate
          ? `Producto cruzado cero. Las contribuciones valen ${dots[0] / 2} y ${dots[1] / 2} tras normalizar por dos.`
          : 'Los dos códigos coinciden. La correlación mide la mezcla, sin separar las contribuciones.'],
      }
    }
    case 'parity': {
      const sum = (bits: number[]) => bits.reduce((a, b) => a + b, 0)
      const data = [...profile.bits].map(Number)
      const parity = values[0] === 'Par' ? 0 : 1
      const bit = (sum(data) % 2) ^ parity
      const sent = [...data, bit]
      const received = sent.map((b, i) => b ^ Number(values[i + 1]))
      return {
        facts: [`Datos originales: ${profile.bits}. El bit de paridad va al final.`],
        answers: [closed('Bit de paridad generado', String(bit), ['0', '1']), closed('¿Pasa la comprobación?', yes(sum(received) % 2 === parity))],
        steps: [`Envío: ${sent.join('')}. Recepción: ${received.join('')}. Unos recibidos: ${sum(received)}.`,
          'La comprobación observa la paridad total. Dos inversiones pueden pasar sin detectar.'],
      }
    }
    case 'checksum':
    case 'fcs': {
      const bytes = profile.vectors.find(v => v.title === values[0])!.bytes
      const flipped = values[1] !== 'Sin cambio'
      if (profile.kind === 'checksum') {
        const data = [...bytes]
        if (flipped) data[0] ^= 1
        const words = []
        for (let i = 0; i < data.length; i += 2) words.push(data[i] * 256 + (data[i + 1] ?? 0))
        let sum = words.reduce((a, b) => a + b, 0)
        while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16)
        return {
          facts: [`Octetos iniciales en hexadecimal: ${bytesText(bytes)}.`, 'Checksum de complemento a uno. Si falta el octeto bajo de la última palabra, se completa con cero.'],
          answers: [exact('Checksum de los datos resultantes (hexadecimal)', hex(sum ^ 0xffff, 4), 'hex')],
          steps: [`Octetos resultantes: ${bytesText(data)}. Palabras: ${words.map(n => hex(n, 4)).join(' ')}.`,
            `Suma plegada ${hex(sum, 4)}. Complementa sus 16 bits.`],
        }
      }
      const crc = fcs(bytes) ^ 0xffff
      const wire = [crc & 0xff, crc >>> 8]
      const received = [...bytes, ...wire]
      if (flipped) received[0] ^= 1
      const remainder = fcs(received)
      return {
        facts: [`Octetos originales en hexadecimal: ${bytesText(bytes)}.`, 'Se anexa el FCS PPP de 16 bits antes de aplicar la alteración al primer octeto.'],
        answers: [closed('¿Pasa la comprobación de FCS?', yes(remainder === 0xf0b8))],
        steps: [`FCS anexado, octeto bajo primero: ${bytesText(wire)}.`,
          `Se recibe ${bytesText(received)}. Residuo: ${hex(remainder, 4)}. El perfil comprueba F0B8.`],
      }
    }
    case 'xor': {
      const repair = profile.symbols[0] ^ profile.symbols[1] ^ profile.symbols[2]
      const index = frameControls(profile)[0].options.indexOf(values[0])
      const lost = index === 4 ? [0, 1] : index > 0 ? [index - 1] : []
      const remaining = profile.symbols.filter((_, i) => !lost.includes(i))
      const recovery = remaining.reduce((v, n) => v ^ n, repair)
      return {
        facts: [`Símbolos recibidos: ${profile.symbols.map((n, i) => lost.includes(i) ? '?' : hex(n, 2)).join(' ')}. Reparación XOR: ${hex(repair, 2)}.`,
          'Escribe un guion si no hay un único símbolo que recuperar.'],
        answers: [closed('¿Hay una única pérdida recuperable?', yes(lost.length === 1)),
          exact('Símbolo recuperado (hexadecimal) o guion', lost.length === 1 ? hex(recovery, 2) : '-', 'hex-or-dash')],
        steps: [lost.length === 1 ? `Reparación XOR conocidos: ${[repair, ...remaining].map(n => hex(n, 2)).join(' ⊕ ')} = ${hex(recovery, 2)}.`
          : lost.length === 0 ? 'Se recibieron los tres símbolos.' : 'Una ecuación XOR para dos símbolos desconocidos no fija un par único.'],
      }
    }
    case 'arq': {
      const size = profile.sizes.find(s => values[0] === `${s.frameBits} bits`)!
      const lostData = values[1] === 'Trama perdida'
      const lostAck = values[1] === 'Trama recibida y ACK perdido'
      const sends = lostData || lostAck ? 3 : 2
      return {
        facts: [`Dos tramas A y B. Cada trama ocupa ${size.frameBits} bits, de los cuales ${size.payloadBits} son útiles. Cada ACK ocupa ${size.ackBits} bits.`,
          'Solo falla lo indicado para el primer envío de A. Si se pierde el ACK, el receptor reconoce el duplicado. El siguiente intento se confirma.'],
        answers: [closed('Secuencia de envíos', sends === 3 ? 'A, A, B' : 'A, B', ['A, B', 'A, A, B']),
          exact('Bits enviados hacia el receptor', sends * size.frameBits, 'integer'),
          exact('Bits enviados en ACK', (lostAck ? 3 : 2) * size.ackBits, 'integer'),
          exact('Bits útiles entregados sin duplicados', 2 * size.payloadBits, 'integer'),
          exact('Fracción útil de una trama (útiles/enviados)', `${size.payloadBits}/${size.frameBits}`, 'fraction')],
        steps: [`Envíos: ${sends === 3 ? 'A, A, B' : 'A, B'}. ACK emitidos: ${lostAck ? 3 : 2}. Una pérdida de trama no genera ACK.`,
          `Cada trama lleva ${size.frameBits - size.payloadBits} bits no útiles. El total útil cuenta A y B una sola vez.`],
      }
    }
  }
}

function normalize(answer: Answer, raw: string): string | undefined {
  if (answer.options) return answer.options.includes(raw) ? raw : undefined
  const text = raw.trim().toUpperCase()
  switch (answer.format) {
    case 'sequence': return /^[A-Z0-9]+$|^-$/.test(text.replace(/[\s,]+/g, '')) ? text.replace(/[\s,]+/g, '') : undefined
    case 'hex':
    case 'hex-or-dash': {
      const hexText = text.replace(/^0X/, '')
      if (text === '-' && answer.format === 'hex-or-dash') return '-'
      return /^[0-9A-F]{1,4}$/.test(hexText) ? String(parseInt(hexText, 16)) : undefined
    }
    case 'integer': return /^\d{1,9}$/.test(text) ? String(Number(text)) : undefined
    case 'fraction': return /^\d{1,6}\s*\/\s*[1-9]\d{0,5}$/.test(text) ? text.replace(/\s/g, '') : undefined
  }
}
export function validFrameAnswer(answer: Answer, raw: string): boolean {
  return normalize(answer, raw) !== undefined
}
export function matchesFrameAnswer(answer: Answer, raw: string): boolean {
  const value = normalize(answer, raw)
  if (value === undefined) return false
  if (answer.format === 'fraction') {
    const [n, d] = value.split('/').map(Number)
    const [a, b] = answer.expected.split('/').map(Number)
    return n * b === a * d
  }
  return value === normalize(answer, answer.expected)
}
export function parseFrameDraft(raw: string, profile: FrameProfile): { controls: string[]; answers: string[] } {
  let value: unknown
  try { value = JSON.parse(raw) } catch { value = undefined }
  const stored = isRecord(value) ? value : {}
  const choices = Array.isArray(stored.controls) ? stored.controls : []
  const predictions = Array.isArray(stored.answers) ? stored.answers : []
  const schema = frameControls(profile)
  const valid = choices.length === schema.length && schema.every((control, i) => control.options.includes(choices[i]))
  const controls = valid ? choices as string[] : schema.map(control => control.initial)
  const answers = describeFrame(profile, controls).answers.map((_, i) =>
    valid && typeof predictions[i] === 'string' && predictions[i].length <= 40 ? predictions[i] : '')
  return { controls, answers }
}
