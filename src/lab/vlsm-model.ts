import { formatIPv4, validateInput } from './ipv4'
import type { PredictionControl, PredictionExercise } from './prediction'

export const VLSM_MODEL_VERSION = 'vlsm-model-v1'

type Demand = { name: string; kind: 'lan' | 'p2p' | 'host'; count: number }
type Scenario = { label: string; parent: string; occupied: string[]; demands: Demand[] }
type Block = { start: number; end: number; prefix: number }
export type VlsmProfile = { scenarios: Scenario[] }

const noBlock = 'Sin bloque alineado'
const meaning = {
  lan: 'LAN convencional; el recuento incluye todas las interfaces requeridas',
  p2p: 'dos extremos punto a punto compatibles con RFC 3021',
  host: 'destino único de una ruta; se reserva una dirección del inventario',
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function label(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 60 && value.trim() === value
}

function block(raw: unknown): Block | undefined {
  if (typeof raw !== 'string' || raw.length > 18 || raw.trim() !== raw) return
  const parts = raw.split('/')
  if (parts.length !== 2 || parts.some(part => part.trim() !== part)) return
  const [address, value] = parts
  const parsed = validateInput({ address, value, format: 'prefix', probe: '', context: 'numeric' })
  if (!parsed.ok) return
  const { addressNumber: start, prefix } = parsed.input
  const size = 2 ** (32 - prefix)
  if (start % size === 0) return { start, end: start + size, prefix }
}

function validDemand(value: unknown): value is Demand {
  if (!record(value) || !label(value.name)) return false
  const { kind, count } = value
  if (kind === 'p2p') return count === 2
  if (kind === 'host') return count === 1
  return kind === 'lan' && typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= 2 ** 32 - 2
}

function validScenario(value: unknown): value is Scenario {
  if (!record(value) || !label(value.label)) return false
  const parent = block(value.parent)
  const { occupied, demands } = value
  if (!parent || !Array.isArray(occupied) || occupied.length > 24
    || !Array.isArray(demands) || demands.length < 1 || demands.length > 8 || !demands.every(validDemand)) return false
  if (new Set(demands.map(demand => demand.name)).size !== demands.length) return false
  const ranges: Block[] = []
  for (const raw of occupied) {
    const range = block(raw)
    if (!range || range.start < parent.start || range.end > parent.end
      || ranges.some(other => range.start < other.end && other.start < range.end)) return false
    ranges.push(range)
  }
  return true
}

export function validVlsmProfile(value: unknown): value is VlsmProfile {
  if (!record(value) || !Array.isArray(value.scenarios) || value.scenarios.length < 2
    || value.scenarios.length > 12 || !value.scenarios.every(validScenario)) return false
  return new Set(value.scenarios.map(scenario => scenario.label)).size === value.scenarios.length
}

export function vlsmControls(profile: VlsmProfile): PredictionControl[] {
  const options = profile.scenarios.map(scenario => scenario.label)
  return [{ label: 'Caso preparado', options, initial: options[0] }]
}

function prefixFor(demand: Demand): number {
  if (demand.kind === 'p2p') return 31
  if (demand.kind === 'host') return 32
  // log2 may round down immediately above a power of two at the top of the IPv4 range.
  const minimum = demand.count + 2
  const bits = Math.floor(Math.log2(minimum))
  return 32 - (2 ** bits < minimum ? bits + 1 : bits)
}

function firstFree(parent: Block, occupied: Block[], size: number): number | undefined {
  if (size > parent.end - parent.start) return
  let start = parent.start
  for (const range of occupied) {
    if (start + size <= range.start) break
    if (start < range.end) start = Math.ceil(range.end / size) * size
  }
  if (start + size <= parent.end) return start
}

const cidr = (start: number, prefix: number) => `${formatIPv4(start)}/${prefix}`

export function describeVlsm(profile: VlsmProfile, values: string[]): PredictionExercise {
  const scenario = profile.scenarios.find(entry => entry.label === values[0]) ?? profile.scenarios[0]
  // The package validator checks each range before the player receives the profile.
  const parent = block(scenario.parent)!
  const occupied = scenario.occupied.map(spec => block(spec)!).sort((a, b) => a.start - b.start)
  const trace: string[] = []
  const exercise: PredictionExercise = {
    facts: [
      `Bloque padre: ${scenario.parent}.`,
      `Ocupaciones que no se pueden mover: ${scenario.occupied.join(', ') || 'ninguna'}.`,
      'Procesa los destinos en el orden indicado. Usa el bloque más pequeño que cumpla y la primera base alineada libre.',
      ...scenario.demands.map(({ name, kind, count }) => `${name}: ${count} · ${meaning[kind]}.`),
    ],
    answers: [], steps: [], trace,
  }
  for (const demand of scenario.demands) {
    const prefix = prefixFor(demand)
    const size = 2 ** (32 - prefix)
    const start = firstFree(parent, occupied, size)
    const expected = start === undefined ? noBlock : cidr(start, prefix)
    const count = Math.floor((parent.end - parent.start) / size)
    const bases = Array.from({ length: Math.min(3, count) }, (_, i) => parent.start + i * size)
    if (count) bases.push(parent.end - size)
    if (start !== undefined) {
      bases.push(start)
      if (start - size >= parent.start) bases.push(start - size)
      if (start + 2 * size <= parent.end) bases.push(start + size)
    }
    const options = [...new Set(bases)].sort((a, b) => a - b).map(base => cidr(base, prefix))
    if (!count) options.push(scenario.parent)
    options.push(noBlock)
    exercise.answers.push(
      { label: `Prefijo mínimo suficiente para ${demand.name}`, expected: String(prefix), format: 'integer' },
      { label: `Primera asignación que cumple para ${demand.name}`, expected, options },
    )
    exercise.steps.push(demand.kind === 'lan'
      ? `${demand.name} necesita /${prefix}: ${size - 2} direcciones utilizables.`
      : `${demand.name} usa /${prefix} en el perfil declarado.`)
    if (start === undefined) {
      trace.push(count
        ? `${demand.name}: ninguna de las ${count} bases alineadas del tamaño requerido está libre.`
        : `${demand.name}: el bloque /${prefix} es mayor que el bloque padre.`)
    } else {
      trace.push(`${demand.name}: ${formatIPv4(start)}–${formatIPv4(start + size - 1)}. Se añade ${expected} a las ocupaciones.`)
      occupied.push({ start, end: start + size, prefix })
      occupied.sort((a, b) => a.start - b.start)
    }
  }
  return exercise
}
