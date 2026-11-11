import type { PredictionControl, PredictionExercise } from './prediction'

export const SERVICE_CAPACITY_MODEL_VERSION = 'service-capacity-model-v1'

type Scenario = {
  label: string
  demand: number
  edgeHits: number
  replicaSlots: number[]
  dataSlots: number
  entries: 1 | 2
}
export type ServiceCapacityProfile = {
  kind: 'capacity' | 'failure'
  cases: Scenario[]
}
type Fault = 'none' | 'entry' | 'edge' | 'data' | number
type Limitation = 'none' | 'entry' | 'replicas' | 'data' | 'both'

const labels: Record<Limitation, string> = {
  none: 'Demanda cubierta',
  entry: 'Entrada',
  replicas: 'Réplicas de aplicación',
  data: 'Almacén de datos',
  both: 'Réplicas y datos',
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

function validScenario(value: unknown): value is Scenario {
  if (!object(value)) return false
  const { label, demand, edgeHits, replicaSlots, dataSlots, entries } = value
  return typeof label === 'string' && label.length > 0 && label.length <= 80 && label === label.trim()
    && !/[\u0000-\u001f]/.test(label) && whole(demand, 0, 1000) && whole(edgeHits, 0, demand)
    && Array.isArray(replicaSlots) && whole(replicaSlots.length, 1, 4) && replicaSlots.every(v => whole(v, 1, 1000))
    && whole(dataSlots, 1, 1000) && whole(entries, 1, 2)
    && Object.keys(value).length === 6
}

export function validServiceCapacityProfile(value: unknown): value is ServiceCapacityProfile {
  if (!object(value) || Object.keys(value).length !== 2) return false
  const { kind, cases } = value
  if ((kind !== 'capacity' && kind !== 'failure') || !Array.isArray(cases)
    || !whole(cases.length, 2, 8) || !cases.every(validScenario)
    || new Set(cases.map(c => c.label)).size !== cases.length) return false
  return kind === 'capacity' || cases.every(c => c.replicaSlots.length === cases[0].replicaSlots.length)
}

export function solveServiceCapacity(c: Scenario, fault: Fault) {
  const readyEntries = c.entries - Number(fault === 'entry')
  const hits = fault === 'edge' || readyEntries === 0 ? 0 : c.edgeHits
  const appSlots = c.replicaSlots.reduce((sum, slots, i) => sum + (fault === i ? 0 : slots), 0)
  const dataSlots = fault === 'data' ? 0 : c.dataSlots
  const toOrigin = readyEntries === 0 ? 0 : c.demand - hits
  const fromOrigin = Math.min(toOrigin, appSlots, dataSlots)
  const completed = hits + fromOrigin
  const incomplete = c.demand - completed
  let limitation: Limitation = 'none'
  if (incomplete > 0) {
    if (readyEntries === 0) limitation = 'entry'
    else if (appSlots < dataSlots) limitation = 'replicas'
    else if (dataSlots < appSlots) limitation = 'data'
    else limitation = 'both'
  }
  return { readyEntries, hits, appSlots, dataSlots, toOrigin, fromOrigin, completed, incomplete, limitation }
}

function faults(profile: ServiceCapacityProfile): { name: string; value: Fault }[] {
  return [
    { name: 'Sin fallo', value: 'none' },
    { name: 'Una entrada', value: 'entry' },
    ...profile.cases[0].replicaSlots.map((_, i) => ({ name: 'Réplica ' + (i + 1), value: i })),
    { name: 'Caché de borde', value: 'edge' },
    { name: 'Almacén de datos', value: 'data' },
  ]
}

export function serviceCapacityControls(profile: ServiceCapacityProfile): PredictionControl[] {
  const options = profile.cases.map(c => c.label)
  const controls: PredictionControl[] = [{ label: 'Configuración', options, initial: options[0] }]
  if (profile.kind === 'failure') controls.push({
    label: 'Componente que falla', options: faults(profile).map(f => f.name), initial: 'Sin fallo',
  })
  return controls
}

export function describeServiceCapacity(profile: ServiceCapacityProfile, values: string[]): PredictionExercise {
  const c = profile.cases.find(row => row.label === values[0]) ?? profile.cases[0]
  const change = profile.kind === 'failure' ? faults(profile).find(f => f.name === values[1]) : undefined
  const out = solveServiceCapacity(c, change?.value ?? 'none')
  const trace = [
    `Entradas operativas: ${out.readyEntries} de ${c.entries}. La capacidad de entrada es suficiente si queda alguna.`,
    `La caché completa ${out.hits} solicitudes. ${out.toOrigin} llegan al recorrido con aplicación y datos.`,
    `Hay ${out.appSlots} plazas de aplicación y ${out.dataSlots} de datos. El origen completa ${out.fromOrigin} solicitudes.`,
    `Se completan ${out.completed} de ${c.demand}. Quedan ${out.incomplete} sin completar. Resultado: ${labels[out.limitation]}.`,
  ]
  return {
    facts: [
      'Todas las cifras corresponden a una ventana fija. Las entradas operativas tienen margen suficiente.',
      `Demanda: ${c.demand}. Aciertos elegibles si la caché está operativa: ${c.edgeHits}.`,
      `Plazas de aplicación por réplica: ${c.replicaSlots.join(', ')}. Plazas de datos: ${c.dataSlots}. Entradas: ${c.entries}.`,
      'El balanceador distribuye las peticiones de origen entre réplicas sanas hasta agotar sus plazas. Cada petición al origen ocupa además una plaza de datos.',
      'Los aciertos de caché se sirven en la entrada y no usan aplicación ni datos. El fallo de caché deriva esa demanda al origen.',
    ],
    answers: [
      { label: 'Solicitudes completadas', format: 'integer', expected: String(out.completed) },
      { label: 'Solicitudes sin completar', format: 'integer', expected: String(out.incomplete) },
      { label: 'Límite en esta ventana', options: Object.values(labels), expected: labels[out.limitation] },
    ],
    steps: trace,
    trace,
  }
}
