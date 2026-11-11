import type { PredictionControl, PredictionExercise } from './prediction'

export const STACK_MODEL_VERSION = 'stack-model-v1'
const sum = 'Suma con paso de dos'
const fibonacci = 'Fibonacci sin memoria'
const argumentsAllowed = Array.from({ length: 9 }, (_, i) => String(i))
export const stackControls: PredictionControl[] = [
  { label: 'Función', options: [sum, fibonacci], initial: sum },
  { label: 'Argumento inicial', options: argumentsAllowed, initial: '5' },
]

type StackFrame = { id: number; argument: number }
export type StackEvent = {
  type: 'entry' | 'return'
  frame: StackFrame
  value?: number
  active: StackFrame[]
}
export function traceStack(variant: 'sum-step-two' | 'fibonacci', start: number) {
  if ((variant !== 'sum-step-two' && variant !== 'fibonacci') || !Number.isInteger(start) || start < 0 || start > 8) {
    throw new RangeError('Función o argumento fuera del modelo de pila.')
  }
  const events: StackEvent[] = []
  const active: StackFrame[] = []
  let total = 0
  let maximum = 0
  const isSum = variant === 'sum-step-two'

  function visit(argument: number): number {
    const frame = { id: ++total, argument }
    active.push(frame)
    maximum = Math.max(maximum, active.length)
    events.push({ type: 'entry', frame, active: [...active] })
    const value = isSum
      ? argument <= 0 ? 0 : argument + visit(argument - 2)
      : argument <= 1 ? argument : visit(argument - 1) + visit(argument - 2)
    active.pop()
    events.push({ type: 'return', frame, value, active: [...active] })
    return value
  }
  const value = visit(start)
  return { value, total, maximum, events }
}

export function describeStack([variant, initial]: string[]): PredictionExercise {
  const isSum = variant === sum
  const { value, total, maximum, events } = traceStack(isSum ? 'sum-step-two' : 'fibonacci', Number(initial))
  const sequence = (type: StackEvent['type']) =>
    events.filter(event => event.type === type).map(event => event.frame.argument).join(', ')
  return {
    facts: [
      isSum ? 'S(n) devuelve 0 si n ≤ 0. En otro caso devuelve n + S(n − 2).'
        : 'F(n) devuelve n si n ≤ 1. En otro caso evalúa F(n − 1) antes de F(n − 2) y suma ambos resultados.',
      'Cuenta todos los marcos de la función, incluidos el inicial y los casos base. Escribe los argumentos separados por espacios o comas, con los repetidos en su posición.',
    ],
    answers: [
      { label: 'Argumentos en orden de entrada', expected: sequence('entry'), format: 'signed-list' },
      { label: 'Argumentos en orden de retorno', expected: sequence('return'), format: 'signed-list' },
      { label: 'Profundidad máxima', expected: String(maximum), format: 'integer' },
      { label: 'Total de activaciones', expected: String(total), format: 'integer' },
      { label: 'Resultado de la función', expected: String(value), format: 'integer' },
    ],
    steps: ['El total cuenta todas las entradas. La profundidad cuenta solo los marcos activos en el punto más profundo.'],
    trace: events.map(({ type, frame, value: result, active }) => {
      const action = type === 'entry' ? 'Entra' : 'Retorna'
      const detail = type === 'return' ? ` y devuelve ${result}` : ''
      const list = active.map(row => `#${row.id} (n = ${row.argument})`).join(', ')
      return `${action} el marco #${frame.id} con n = ${frame.argument}${detail}. ${list ? `Pila de abajo arriba: ${list}.` : 'Pila vacía.'}`
    }),
  }
}
