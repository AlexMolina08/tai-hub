import type { PredictionAnswer, PredictionControl, PredictionExercise } from './prediction'

export const TRANSACTION_MODEL_VERSION = 'transaction-model-v1'

const isolationLevels = ['READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'] as const
const writeSkewLevels = ['REPEATABLE READ', 'SERIALIZABLE'] as const
const transactionEnds = ['COMMIT', 'ROLLBACK'] as const
const lockSchedules = ['Misma fila, A confirma', 'Misma fila, A revierte', 'Filas independientes', 'Solicitudes en ciclo'] as const

type VisibilityProfile = {
  kind: 'visibility'
  initialIsolation: typeof isolationLevels[number]
  initialEndB: typeof transactionEnds[number]
  initialValue: number
  updatedValue: number
  insertedValue: number
  threshold: number
}
type DeadlockProfile = {
  kind: 'deadlock'
  initialSchedule: typeof lockSchedules[number]
  initialValues: [number, number]
  increments: { aFirst: number; bOther: number; bFirst: number; aOther: number }
}
type WriteSkewProfile = {
  kind: 'write-skew'
  initialIsolation: typeof writeSkewLevels[number]
  initialActive: number
}

export type TransactionProfile = VisibilityProfile | DeadlockProfile | WriteSkewProfile

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOption(options: readonly string[], value: unknown): value is string {
  return typeof value === 'string' && options.includes(value)
}

function natural(value: unknown, min = 0, max = 99_999): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

export function validTransactionProfile(value: unknown): value is TransactionProfile {
  if (!isRecord(value)) return false
  switch (value.kind) {
    case 'visibility':
      return hasOption(isolationLevels, value.initialIsolation) && hasOption(transactionEnds, value.initialEndB)
        && [value.initialValue, value.updatedValue, value.insertedValue, value.threshold].every(entry => natural(entry))
    case 'deadlock':
      return hasOption(lockSchedules, value.initialSchedule)
        && Array.isArray(value.initialValues) && value.initialValues.length === 2 && value.initialValues.every(entry => natural(entry))
        && isRecord(value.increments)
        && [value.increments.aFirst, value.increments.bOther, value.increments.bFirst, value.increments.aOther].every(entry => natural(entry, 1))
    case 'write-skew':
      return hasOption(writeSkewLevels, value.initialIsolation) && natural(value.initialActive, 2, 99)
    default:
      return false
  }
}

function control(label: string, options: readonly string[], initial: string): PredictionControl {
  return { label, options: [...options], initial }
}

export function transactionControls(profile: TransactionProfile): PredictionControl[] {
  switch (profile.kind) {
    case 'visibility':
      return [control('Aislamiento de A', isolationLevels, profile.initialIsolation), control('Fin de B', transactionEnds, profile.initialEndB)]
    case 'deadlock':
      return [control('Calendario de solicitudes', lockSchedules, profile.initialSchedule)]
    case 'write-skew':
      return [control('Aislamiento de ambas sesiones', writeSkewLevels, profile.initialIsolation)]
  }
}

function numberAnswer(label: string, result: number): PredictionAnswer {
  return { label, expected: String(result), format: 'integer' }
}

function choiceAnswer(label: string, options: string[], expected: string): PredictionAnswer {
  return { label, expected, options: [...new Set(options)] }
}

function describeVisibility(profile: VisibilityProfile, level: string, end: string): PredictionExercise {
  const { initialValue, updatedValue, insertedValue, threshold } = profile
  const initial = { value: initialValue, count: Number(initialValue >= threshold) }
  const committed = { value: updatedValue, count: Number(updatedValue >= threshold) + Number(insertedValue >= threshold) }
  const final = end === 'COMMIT' ? committed : initial
  const statementSnapshot = level === 'READ COMMITTED' || level === 'READ UNCOMMITTED'
  const repeated = statementSnapshot ? final : initial
  return {
    facts: ['El calendario usa PostgreSQL 18. Inicialmente existe solo la fila 1.',
      `La fila 1 empieza con valor ${initialValue}. A lee ese valor y cuenta filas con valor >= ${threshold}.`,
      `B cambia la fila 1 a ${updatedValue} e inserta la fila 2 con valor ${insertedValue}.`,
      'A repite las lecturas antes de que B termine, después del fin de B y fuera de su propia transacción.'],
    answers: [numberAnswer('Valor de la fila 1 antes del fin de B', initial.value),
      numberAnswer('Valor de la fila 1 tras el fin de B, dentro de A', repeated.value),
      numberAnswer('Filas que cumplen el predicado tras el fin de B, dentro de A', repeated.count),
      numberAnswer('Filas que cumplen el predicado fuera de la transacción A', final.count)],
    steps: [statementSnapshot
      ? 'En este nivel, cada sentencia ordinaria de A obtiene una instantánea nueva.'
      : 'En este calendario, las lecturas ordinarias de A mantienen la primera instantánea del bloque.'],
    trace: [`A obtiene el valor ${initial.value} y cuenta ${initial.count} filas.`,
      `Las escrituras de B siguen pendientes. A obtiene ${initial.value} y cuenta ${initial.count} filas.`,
      `B termina con ${end}. A obtiene ${repeated.value} y cuenta ${repeated.count} filas.`,
      `Fuera del bloque de A, la consulta obtiene ${final.value} y cuenta ${final.count} filas.`],
  }
}

function describeDeadlock(profile: DeadlockProfile, schedule: string): PredictionExercise {
  const [first, second] = profile.initialValues
  const { aFirst, bOther, bFirst, aOther } = profile.increments
  const firstWithA = first + aFirst
  const finalIfA = `${firstWithA}, ${second + aOther}`
  const finalIfB = `${first + bFirst}, ${second + bOther}`
  const outcomes = [`${firstWithA + bFirst}, ${second}`, `${first + bFirst}, ${second}`,
    `${firstWithA}, ${second + bOther}`, [...new Set([finalIfA, finalIfB])].join(' o ')]
  const selection = lockSchedules.findIndex(option => option === schedule)
  const independent = selection === 2
  const cycle = selection === 3
  const prior = independent || cycle ? `B suma ${bOther} a la fila 2.` : 'B abre su transacción.'
  const pending = independent ? 'B consulta su fila 2.' : `B intenta sumar ${bFirst} a la fila 1.`
  const next = cycle ? `A intenta sumar ${aOther} a la fila 2.` : selection === 1 ? 'A revierte.' : 'A confirma.'
  const outcome = outcomes[selection]
  return {
    facts: [`PostgreSQL 18, READ COMMITTED. Las filas 1 y 2 empiezan en ${first} y ${second}.`,
      `A suma ${aFirst} a la fila 1. ${prior}`, `${pending} ${next}`],
    answers: [
      choiceAnswer('Estado inicial de la última orden de B', ['Termina', 'Espera a A'], independent ? 'Termina' : 'Espera a A'),
      choiceAnswer('Diagnóstico', ['Sin error', 'Deadlock (40P01)'], cycle ? 'Deadlock (40P01)' : 'Sin error'),
      choiceAnswer('Valores finales posibles, en orden de fila', outcomes, outcome),
    ],
    steps: ['La espera va de la sesión que solicita a la que retiene. Un ciclo impide avanzar a sus participantes.'],
    trace: [`A retiene la fila 1. ${prior}`, independent ? 'La lectura de B termina.' : 'B espera a que A libere la fila 1.',
      cycle ? 'La petición de A cierra el ciclo. Una transacción recibe 40P01 y la otra puede terminar.'
        : 'A termina. B puede completar la transacción.', `Valores finales posibles: ${outcome}.`],
  }
}

function describeWriteSkew(profile: WriteSkewProfile, level: string): PredictionExercise {
  const minimum = profile.initialActive - 1
  const rejectsOne = level === 'SERIALIZABLE'
  const final = profile.initialActive - (rejectsOne ? 1 : 2)
  return {
    facts: [`PostgreSQL 18. Hay ${profile.initialActive} registros activos y deben quedar al menos ${minimum}.`,
      'A y B cuentan los registros activos antes de cualquier escritura. Si la cuenta supera el mínimo, cada sesión desactiva una fila distinta.',
      'Ambas transacciones intentan confirmar después de las dos solicitudes de actualización.'],
    answers: [numberAnswer('Cuenta inicial de A', profile.initialActive),
      choiceAnswer('Código de la transacción rechazada', ['Ninguna', '40001'], rejectsOne ? '40001' : 'Ninguna'),
      numberAnswer('Registros activos al terminar', final)],
    steps: ['Cada decisión usa un predicado compartido aunque las escrituras actúan sobre filas distintas.'],
    trace: [`Las dos sesiones cuentan ${profile.initialActive} registros activos.`,
      'Cada sesión intenta desactivar un registro diferente.',
      rejectsOne ? 'Una transacción recibe 40001. Solo una modificación se confirma.' : 'Ambas transacciones confirman en este calendario.',
      `Quedan ${final} registros activos.`],
  }
}

export function describeTransaction(profile: TransactionProfile, selected: string[]): PredictionExercise {
  const values = transactionControls(profile).map((entry, index) => entry.options.includes(selected[index]) ? selected[index] : entry.initial)
  switch (profile.kind) {
    case 'visibility': return describeVisibility(profile, values[0], values[1])
    case 'deadlock': return describeDeadlock(profile, values[0])
    case 'write-skew': return describeWriteSkew(profile, values[0])
  }
}
