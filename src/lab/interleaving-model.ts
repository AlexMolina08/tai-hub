import type { PredictionControl, PredictionExercise } from './prediction'

export const INTERLEAVING_MODEL_VERSION = 'java-interleaving-v1'

export type InterleavingProfile = {
  initial: number
  deltaA: number
  deltaB: number
  synchronized: boolean
}

const actions = {
  'read-a': { worker: 'A', kind: 'read', label: 'A lee el contador' },
  'write-a': { worker: 'A', kind: 'write', label: 'A escribe su resultado' },
  'read-b': { worker: 'B', kind: 'read', label: 'B lee el contador' },
  'write-b': { worker: 'B', kind: 'write', label: 'B escribe su resultado' },
} as const

const labels = Object.entries(actions).map(([id, action]) => [action.label, id] as const)
const actionIds = new Map<string, string>(labels)
const blank = 'Elegir intento'
const maxAttempts = 8

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
}

export function validInterleavingProfile(raw: unknown): raw is InterleavingProfile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const profile = raw as Record<string, unknown>
  return Object.keys(profile).length === 4
    && ['initial', 'deltaA', 'deltaB', 'synchronized'].every(key => Object.hasOwn(profile, key))
    && boundedInteger(profile.initial, 0, 100)
    && boundedInteger(profile.deltaA, 1, 20)
    && boundedInteger(profile.deltaB, 1, 20)
    && typeof profile.synchronized === 'boolean'
}

type Worker = 'A' | 'B'
type InterleavingStep = {
  status: 'accepted' | 'already-done' | 'needs-read' | 'blocked' | 'unsupported'
  description: string
}

export function runInterleaving(profile: InterleavingProfile, attempts: readonly string[]) {
  let counter = profile.initial
  let monitor: Worker | undefined
  const workers = {
    A: { read: undefined as number | undefined, wrote: false, delta: profile.deltaA },
    B: { read: undefined as number | undefined, wrote: false, delta: profile.deltaB },
  }
  const trace = attempts.map((attempt): InterleavingStep => {
    if (!Object.hasOwn(actions, attempt)) return { status: 'unsupported', description: 'Operación desconocida.' }
    const { worker, kind } = actions[attempt as keyof typeof actions]
    const task = workers[worker]
    if (kind === 'read') {
      if (task.read !== undefined) return { status: 'already-done', description: `${worker} ya leyó el contador.` }
      if (monitor && monitor !== worker)
        return { status: 'blocked', description: `La lectura de ${worker} queda bloqueada. ${monitor} conserva el monitor.` }
      task.read = counter
      if (profile.synchronized) monitor = worker
      return {
        status: 'accepted',
        description: `${worker} lee ${counter}.${profile.synchronized ? ` ${worker} conserva el monitor hasta escribir.` : ''}`,
      }
    }
    if (task.wrote) return { status: 'already-done', description: `${worker} ya escribió su resultado.` }
    if (task.read === undefined)
      return { status: 'needs-read', description: `${worker} debe leer antes de escribir.` }
    counter = task.read + task.delta
    task.wrote = true
    monitor = undefined
    return {
      status: 'accepted',
      description: `${worker} escribe ${task.read} + ${task.delta} = ${counter}.${profile.synchronized ? ` ${worker} libera el monitor.` : ''}`,
    }
  })
  const completed = workers.A.wrote && workers.B.wrote
  return {
    completed, counter, trace,
    lostUpdate: completed ? counter !== profile.initial + profile.deltaA + profile.deltaB : null,
  }
}

export function interleavingControls(profile: InterleavingProfile): PredictionControl[] {
  return [
    { label: 'Monitor común', options: ['0', '1'], initial: profile.synchronized ? '1' : '0', toggle: true },
    ...Array.from({ length: maxAttempts }, (_, index) => ({
      label: `Operación del intento ${index + 1}`,
      options: [blank, ...actionIds.keys()],
      initial: blank,
    })),
  ]
}

export function describeInterleaving(profile: InterleavingProfile, values: string[]): PredictionExercise {
  const attempts: string[] = []
  for (const label of values.slice(1)) {
    const action = actionIds.get(label)
    if (!action) break
    attempts.push(action)
  }
  const result = runInterleaving({ ...profile, synchronized: values[0] === '1' }, attempts)
  const notices = result.trace.flatMap(({ status, description }, index) =>
    status === 'accepted' ? [] : [`Intento ${index + 1}. ${description}`])
  return {
    ready: result.completed,
    facts: [
      `El contador empieza en ${profile.initial}. A suma ${profile.deltaA} y B suma ${profile.deltaB}.`,
      'Cada hilo lee una vez y escribe su lectura más su incremento. Puedes cambiar o repetir un intento.',
      ...(result.completed ? [] : ['Completa las dos escrituras para comprobar la predicción.']),
      ...notices,
    ],
    answers: [
      { label: 'Valor final del contador', expected: String(result.counter), format: 'integer' },
      { label: '¿Se perdió una actualización?', expected: result.lostUpdate ? 'Sí' : 'No', options: ['Sí', 'No'] },
    ],
    steps: [result.lostUpdate
      ? 'Una escritura se basa en la lectura anterior al otro incremento. El contador pierde una actualización.'
      : 'Cada escritura parte del valor que corresponde a ese orden. El contador conserva los dos incrementos.'],
    trace: [`Contador inicial ${profile.initial}.`, ...result.trace.map(({ description }, index) => `Intento ${index + 1}. ${description}`)],
  }
}
