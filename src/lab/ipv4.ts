/** Pure IPv4 arithmetic and prediction flow. No I/O, packets, address enumeration or grading by LLM. */
export const MODEL_VERSION = 'tai-ipv4-block-0.1.0'
export const LIMITS = 'Cálculo numérico IPv4: pertenecer al bloque no demuestra asignabilidad, ocupación, ruta ni conectividad. La interpretación convencional o /31 está acotada aquí a bloques completos RFC1918 y contexto explícito; esta limitación del modelo no es una exigencia de RFC3021. No se clasifican direcciones especiales ni se envían paquetes.'

/** Raw form values remain text, including invalid intermediate edits. */
export interface IPv4Input {
  readonly address: string
  readonly format: string
  readonly value: string
  readonly probe: string
  readonly context: string
}
export type IPv4Context = 'numeric' | 'conventional' | 'p2p-compatible'
export type IPv4ErrorCode = 'INPUT_SHAPE' | 'IP_TYPE' | 'IP_FORMAT' | 'IP_RANGE' | 'FORMAT' | 'CONTEXT'
  | 'PREFIX_FORMAT' | 'PREFIX_RANGE' | 'MASK_NONCONTIGUOUS' | 'PREDICTION_FORMAT' | 'EDIT_FIRST' | 'PREDICTION_REQUIRED'
export interface IPv4Error {
  code: IPv4ErrorCode
  field: keyof IPv4Input | 'input' | 'prediction'
  message: string
}
export interface IPv4Failure { ok: false; error: IPv4Error }
export interface IPv4NormalizedInput {
  address: string
  addressNumber: number
  prefix: number
  probe: string | null
  probeNumber: number | null
  context: IPv4Context
}
export interface IPv4Interpretation {
  kind: 'numeric-only' | 'context-mismatch' | 'host-prefix' | 'p2p-private' | 'needs-p2p-context' | 'conventional-private'
  directedBroadcast: string | null
  conventionalInterior: { lower: string; upper: string; count: number } | null
  pointToPointEndpoints: [string, string] | null
  assignability: 'not-determined'
  explanation: string
}
export interface IPv4Calculation {
  ok: true
  modelVersion: string
  address: string
  prefix: number
  mask: string
  lower: string
  upper: string
  addressCount: number
  hostBits: number
  probe: string | null
  probeMember: boolean | null
  probePosition: 'outside' | 'single' | 'lower' | 'upper' | 'interior' | null
  privateBlock: boolean
  interpretation: IPv4Interpretation
  limits: string
}
export interface IPv4Prediction {
  readonly omitted: boolean
  readonly lower: string
  readonly upper: string
  readonly member: 'yes' | 'no' | 'omit'
  readonly interpretationNote: string
}
export type IPv4FieldComparison = 'correct' | 'incorrect' | 'omitted'
export interface IPv4Comparison {
  lower: IPv4FieldComparison
  upper: IPv4FieldComparison
  member: IPv4FieldComparison | 'not-asked'
}
export type IPv4HistoryEvent =
  | { type: 'prediction'; attempt: number; input: IPv4Input; prediction: IPv4Prediction }
  | { type: 'reveal'; attempt: number; modelVersion: string; result: IPv4Calculation; comparison: IPv4Comparison }
  | { type: 'reset'; afterAttempt: number; initialInput: IPv4Input }
export interface IPv4State {
  schema: 1
  modelVersion: string
  phase: 'editing' | 'predicted' | 'revealed'
  initialInput: IPv4Input
  draft: IPv4Input
  prediction: IPv4Prediction | null
  inputSnapshot: IPv4Input | null
  result: IPv4Calculation | null
  comparison: IPv4Comparison | null
  error: IPv4Error | null
  history: readonly IPv4HistoryEvent[]
  /** Local flow counter only; an adapter must supply globally unique persistence identities. */
  nextAttempt: number
}

/** Synthetic default. Study packages provide their own initial inputs at runtime. */
export const DEFAULT_INPUT: Readonly<IPv4Input> = Object.freeze({
  address: '192.168.20.70', format: 'prefix', value: '26', probe: '192.168.20.127', context: 'conventional',
})
const record = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === 'object' && !Array.isArray(raw)
const fail = (code: IPv4ErrorCode, field: IPv4Error['field'], message: string): IPv4Failure => ({ ok: false, error: { code, field, message } })

function readIPv4(raw: unknown, field: keyof IPv4Input): IPv4Failure | { ok: true; text: string; number: number } {
  if (typeof raw !== 'string') return fail('IP_TYPE', field, 'Escribe una dirección IPv4 decimal.')
  const value = raw.trim()
  if (value.length > 15 || !/^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$/.test(value)) {
    return fail('IP_FORMAT', field, 'Usa cuatro octetos decimales, sin ceros iniciales ni sufijo /prefijo.')
  }
  const octets = value.split('.').map(Number)
  if (octets.some(x => x > 255)) return fail('IP_RANGE', field, 'Cada octeto debe estar entre 0 y 255.')
  return { ok: true, text: value, number: octets.reduce((n, x) => n * 256 + x, 0) }
}
const dotted = (n: number) => [24, 16, 8, 0].map(bits => Math.floor(n / 2 ** bits) % 256).join('.')

export function validateInput(raw: unknown): IPv4Failure | { ok: true; input: IPv4NormalizedInput } {
  if (!record(raw)) return fail('INPUT_SHAPE', 'input', 'La entrada debe ser un objeto de campos.')
  const address = readIPv4(raw.address, 'address')
  if (!address.ok) return address
  const format = typeof raw.format === 'string' ? raw.format.trim() : raw.format
  const context = typeof raw.context === 'string' ? raw.context.trim() : raw.context
  if (format !== 'prefix' && format !== 'mask') return fail('FORMAT', 'format', 'Elige prefijo o máscara decimal.')
  if (context !== 'numeric' && context !== 'conventional' && context !== 'p2p-compatible') {
    return fail('CONTEXT', 'context', 'Elige uno de los contextos preparados.')
  }
  let prefix: number
  if (format === 'prefix') {
    if (typeof raw.value !== 'string' || !/^(0|[1-9][0-9]?)$/.test(raw.value.trim())) {
      return fail('PREFIX_FORMAT', 'value', 'Usa un entero decimal sin signo ni barra inicial.')
    }
    prefix = Number(raw.value.trim())
    if (prefix > 32) return fail('PREFIX_RANGE', 'value', 'El prefijo IPv4 debe estar entre 0 y 32.')
  } else {
    const mask = readIPv4(raw.value, 'value')
    if (!mask.ok) return mask
    const bits = mask.number.toString(2).padStart(32, '0')
    if (!/^1*0*$/.test(bits)) return fail('MASK_NONCONTIGUOUS', 'value', 'La máscara CIDR necesita unos contiguos a la izquierda y después solo ceros.')
    prefix = bits.indexOf('0')
    if (prefix === -1) prefix = 32
  }
  if (typeof raw.probe !== 'string') return fail('IP_TYPE', 'probe', 'La dirección de prueba debe ser texto o quedar vacía.')
  const probe = raw.probe.trim() === '' ? null : readIPv4(raw.probe, 'probe')
  if (probe && !probe.ok) return probe
  return { ok: true, input: { address: address.text, addressNumber: address.number, prefix,
    probe: probe?.text ?? null, probeNumber: probe?.number ?? null, context } }
}

// Complete RFC1918 ranges. This conservative scope is a model policy, not an RFC3021 requirement.
const PRIVATE_RANGES: readonly [number, number][] = [
  [167772160, 184549375], // 10.0.0.0–10.255.255.255
  [2886729728, 2887778303], // 172.16.0.0–172.31.255.255
  [3232235520, 3232301055], // 192.168.0.0–192.168.255.255
]

export function calculate(raw: unknown): IPv4Failure | IPv4Calculation {
  const valid = validateInput(raw)
  if (!valid.ok) return valid
  const i = valid.input, addressCount = 2 ** (32 - i.prefix)
  // Number arithmetic keeps /0 and the unsigned IPv4 maximum intact; no signed bitwise coercion.
  const low = Math.floor(i.addressNumber / addressCount) * addressCount, high = low + addressCount - 1
  const lower = dotted(low), upper = dotted(high), mask = dotted(2 ** 32 - addressCount)
  const probeMember = i.probeNumber === null ? null : i.probeNumber >= low && i.probeNumber <= high
  const probePosition = i.probeNumber === null ? null : !probeMember ? 'outside' : low === high ? 'single'
    : i.probeNumber === low ? 'lower' : i.probeNumber === high ? 'upper' : 'interior'
  const privateBlock = PRIVATE_RANGES.some(([a, b]) => low >= a && high <= b)
  const interpretation: IPv4Interpretation = { kind: 'numeric-only', directedBroadcast: null, conventionalInterior: null,
    pointToPointEndpoints: null, assignability: 'not-determined',
    explanation: 'Se muestran límites inclusivos y pertenencia; no se interpreta el uso operativo del bloque.' }
  if (i.context === 'p2p-compatible' && i.prefix !== 31) {
    interpretation.kind = 'context-mismatch'
    interpretation.explanation = 'Este contexto del modelo declara RFC3021 para /31. El prefijo elegido no es /31; conserva el cálculo numérico, sin aplicar esa interpretación.'
  } else if (i.prefix === 32) {
    interpretation.kind = 'host-prefix'
    interpretation.explanation = 'Coincidencia exacta de una dirección: prefijo/ruta de host. No determina que sea asignable, alcanzable o apropiada como destino; no crea un enlace ni gateway.'
  } else if (i.context === 'numeric') {
    // Numeric mode deliberately makes no broadcast or endpoint claim.
  } else if (!privateBlock) {
    interpretation.explanation = 'El bloque no está entero dentro de RFC1918. El cálculo sigue siendo válido; este modelo no clasifica su uso ni lo etiqueta como subred unicast convencional, broadcast dirigido o extremos asignables.'
  } else if (i.prefix === 31) {
    if (i.context === 'p2p-compatible') {
      interpretation.kind = 'p2p-private'
      interpretation.pointToPointEndpoints = [lower, upper]
      interpretation.explanation = 'Con ambos equipos compatibles y enlace punto a punto RFC3021, las dos direcciones identifican extremos; no hay broadcast dirigido del bloque. Esto no verifica configuración, ocupación ni conectividad.'
    } else {
      interpretation.kind = 'needs-p2p-context'
      interpretation.explanation = 'Hay dos direcciones numéricas. El contexto convencional no justifica aplicar RFC3021 ni restar dos como regla universal; especifica enlace punto a punto compatible para esa interpretación.'
    }
  } else {
    interpretation.kind = 'conventional-private'
    interpretation.directedBroadcast = upper
    interpretation.conventionalInterior = { lower: dotted(low + 1), upper: dotted(high - 1), count: addressCount - 2 }
    interpretation.explanation = 'Bajo el contexto declarado de subred unicast convencional, el límite superior es su broadcast dirigido y el inferior su dirección de red. El intervalo interior es aritmético: no certifica direcciones libres, permitidas o correctamente configuradas.'
  }
  return { ok: true, modelVersion: MODEL_VERSION, address: i.address, prefix: i.prefix, mask, lower, upper,
    addressCount, hostBits: 32 - i.prefix, probe: i.probe, probeMember, probePosition, privateBlock, interpretation, limits: LIMITS }
}

export function createState(initialInput: IPv4Input = DEFAULT_INPUT): IPv4State {
  return { schema: 1, modelVersion: MODEL_VERSION, phase: 'editing', initialInput: structuredClone(initialInput),
    draft: structuredClone(initialInput), prediction: null, inputSnapshot: null, result: null, comparison: null,
    error: null, history: [], nextAttempt: 1 }
}

export function editInput(state: IPv4State, patch: Partial<IPv4Input>): IPv4State {
  return { ...state, draft: { ...state.draft, ...structuredClone(patch) }, phase: 'editing', prediction: null,
    inputSnapshot: null, result: null, comparison: null, error: null }
}

function predictionValue(raw: unknown): IPv4Failure | { ok: true; prediction: IPv4Prediction } {
  if (!record(raw)) return fail('PREDICTION_FORMAT', 'prediction', 'Registra una predicción o una omisión explícita.')
  if (raw.omitted === true) return { ok: true, prediction: { omitted: true, lower: '', upper: '', member: 'omit', interpretationNote: '' } }
  const { lower = '', upper = '', member = 'omit', interpretationNote = '' } = raw
  if (typeof lower !== 'string' || typeof upper !== 'string' || lower.length > 64 || upper.length > 64
    || (member !== 'yes' && member !== 'no' && member !== 'omit') || typeof interpretationNote !== 'string'
    || interpretationNote.length > 500 || (!lower.trim() && !upper.trim() && member === 'omit' && !interpretationNote.trim())) {
    return fail('PREDICTION_FORMAT', 'prediction', 'Escribe al menos una predicción o elige omitir explícitamente.')
  }
  return { ok: true, prediction: { omitted: false, lower: lower.trim(), upper: upper.trim(), member, interpretationNote: interpretationNote.trim() } }
}

export function submitPrediction(state: IPv4State, raw: unknown): IPv4State {
  if (state.phase !== 'editing') return { ...state, error: { code: 'EDIT_FIRST', field: 'prediction', message: 'Edita el caso o reinicia para abrir otro intento.' } }
  const valid = validateInput(state.draft)
  if (!valid.ok) return { ...state, error: valid.error }
  const p = predictionValue(raw)
  if (!p.ok) return { ...state, error: p.error }
  const snapshot = structuredClone(state.draft), prediction = p.prediction, attempt = state.nextAttempt
  return { ...state, phase: 'predicted', inputSnapshot: snapshot, prediction, error: null, nextAttempt: attempt + 1,
    history: [...state.history, { type: 'prediction', attempt, input: snapshot, prediction }] }
}

export function reveal(state: IPv4State): IPv4State {
  if (state.phase === 'revealed') return state
  if (state.phase !== 'predicted' || !state.inputSnapshot || !state.prediction) return { ...state,
    error: { code: 'PREDICTION_REQUIRED', field: 'prediction', message: 'Antes del cálculo, registra tu predicción o una omisión explícita.' } }
  const result = calculate(state.inputSnapshot)
  if (!result.ok) return { ...state, error: result.error }
  const p = state.prediction
  const check = (value: string, expected: string): IPv4FieldComparison => !value ? 'omitted' : value === expected ? 'correct' : 'incorrect'
  const comparison: IPv4Comparison = { lower: check(p.lower, result.lower), upper: check(p.upper, result.upper),
    member: result.probeMember === null ? 'not-asked' : p.member === 'omit' ? 'omitted'
      : (p.member === 'yes') === result.probeMember ? 'correct' : 'incorrect' }
  return { ...state, phase: 'revealed', result, comparison, error: null,
    history: [...state.history, { type: 'reveal', attempt: state.nextAttempt - 1, modelVersion: MODEL_VERSION,
      result: structuredClone(result), comparison }] }
}

/** Reset opens a new draft and records the action without erasing earlier predictions or results. */
export function reset(state: IPv4State): IPv4State {
  return { ...createState(state.initialInput), history: [...structuredClone(state.history),
    { type: 'reset', afterAttempt: state.nextAttempt - 1, initialInput: structuredClone(state.initialInput) }], nextAttempt: state.nextAttempt }
}
