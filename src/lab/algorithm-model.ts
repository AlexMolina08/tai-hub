import type { PredictionAnswer, PredictionControl, PredictionExercise } from './prediction'

export const ALGORITHM_MODEL_VERSION = 'algorithm-model-v1'
type Operation = number | 'remove'
type Named<T> = { label: string; values: T[] }
export type AlgorithmProfile =
  | { kind: 'discipline'; sequences: Named<Operation>[] }
  | { kind: 'tree'; keys: number[]; add: number; remove: number }
  | { kind: 'comparison'; sorted: number[]; present: number; absent: number; sorts: Named<number>[] }

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const number = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99
const numbers = (v: unknown): v is number[] => Array.isArray(v) && v.length >= 2 && v.length <= 8 && v.every(number)
const labeled = <T>(v: unknown, valid: (values: unknown) => values is T[]): v is Named<T>[] =>
  Array.isArray(v) && v.length >= 2 && v.length <= 4 && v.every(row => record(row)
    && typeof row.label === 'string' && row.label.trim() === row.label && row.label.length > 0 && row.label.length <= 48
    && valid(row.values)) && new Set(v.map(row => row.label)).size === v.length
const operations = (v: unknown): v is Operation[] =>
  Array.isArray(v) && v.length >= 2 && v.length <= 10 && v.every(op => op === 'remove' || number(op))
    && v.includes('remove') && v.some(number)

export function validAlgorithmProfile(v: unknown): v is AlgorithmProfile {
  if (!record(v)) return false
  switch (v.kind) {
    case 'discipline':
      return labeled(v.sequences, operations)
    case 'tree': {
      const { keys, add, remove } = v
      return numbers(keys) && new Set(keys).size === keys.length && keys.some(n => n < keys[0]) && keys.some(n => n > keys[0])
        && number(add) && !keys.includes(add) && number(remove) && remove !== keys[0] && keys.includes(remove)
    }
    case 'comparison': {
      const { sorted, present, absent } = v
      return numbers(sorted) && sorted.every((n,i) => i === 0 || sorted[i - 1] < n)
        && number(present) && sorted.includes(present) && number(absent) && !sorted.includes(absent) && labeled(v.sorts, numbers)
    }
    default:
      return false
  }
}

const list = (values: number[]) => values.join(', ') || '-'
const quantity = (label: string, value: number): PredictionAnswer => ({ label, expected: String(value), format: 'integer' })
const sequence = (label: string, values: number[]): PredictionAnswer => ({ label, expected: list(values), format: 'signed-list' })
const select = (label: string, options: string[], initial = options[0]): PredictionControl => ({ label, options, initial })
const orders = ['Preorden', 'Inorden', 'Postorden']
const searchCases = ['Lineal, clave presente', 'Binaria, clave presente', 'Binaria, clave ausente']
const sortLabel = (label: string) => `Inserción · ${label}`
const successor = 'Borrar raíz con sucesor'
const predecessor = 'Borrar raíz con predecesor'

export function algorithmControls(profile: AlgorithmProfile): PredictionControl[] {
  switch (profile.kind) {
    case 'discipline':
      return [select('Estructura', ['Pila', 'Cola']), select('Secuencia', profile.sequences.map(row => row.label))]
    case 'tree':
      return [select('Cambio', [`Insertar ${profile.add}`, successor, predecessor, `Borrar ${profile.remove}`]),
        select('Recorrido', orders, 'Inorden')]
    case 'comparison':
      return [select('Caso', [...searchCases, ...profile.sorts.map(row => sortLabel(row.label))], searchCases[1])]
  }
}

export function traceDiscipline(kind: 'stack' | 'queue', input: Operation[]) {
  const pending: number[] = []
  const removed: number[] = []
  let empty = 0
  const trace = input.map(operation => {
    if (operation !== 'remove') {
      pending.push(operation)
      return `Se añade ${operation}. Quedan ${list(pending)}.`
    }
    const value = kind === 'stack' ? pending.pop() : pending.shift()
    if (value === undefined) {
      empty++
      return 'Se intenta retirar de una estructura vacía.'
    }
    removed.push(value)
    return `Se retira ${value}. Quedan ${list(pending)}.`
  })
  return { pending, removed, empty, trace }
}

type Node = { key: number; left?: Node; right?: Node }
type TreeChange = { kind: 'insert' | 'successor' | 'predecessor'; key: number }
type Order = 'Preorden' | 'Inorden' | 'Postorden'
export function traceTree(keys: number[], change: TreeChange, order: Order) {
  const visits: number[] = []
  const trace: string[] = []
  function insert(node: Node | undefined, key: number): Node {
    if (!node) {
      trace.push(`Se inserta ${key} en el enlace vacío.`)
      return { key }
    }
    trace.push(`Se compara ${key} con ${node.key}.`)
    if (key < node.key) node.left = insert(node.left, key)
    else node.right = insert(node.right, key)
    return node
  }
  function remove(node: Node, key: number, preferSuccessor: boolean): Node | undefined {
    if (key < node.key) node.left = remove(node.left!, key, preferSuccessor)
    else if (key > node.key) node.right = remove(node.right!, key, preferSuccessor)
    else if (!node.left || !node.right) {
      trace.push(`Se retira ${node.key}. Su único hijo ocupa el enlace si existe.`)
      return node.left ?? node.right
    } else {
      const side = preferSuccessor ? 'right' : 'left'
      const toward = preferSuccessor ? 'left' : 'right'
      let substitute = node[side]!
      while (substitute[toward]) substitute = substitute[toward]!
      trace.push(`Se sustituye ${node.key} por ${substitute.key}.`)
      node.key = substitute.key
      node[side] = remove(node[side]!, substitute.key, preferSuccessor)
    }
    return node
  }
  function visit(node?: Node) {
    if (!node) return
    const recordVisit = () => {
      visits.push(node.key)
      trace.push(`Se visita ${node.key}.`)
    }
    if (order === 'Preorden') recordVisit()
    visit(node.left)
    if (order === 'Inorden') recordVisit()
    visit(node.right)
    if (order === 'Postorden') recordVisit()
  }
  let root: Node | undefined
  for (const key of keys) root = insert(root, key)
  if (change.kind === 'insert') root = insert(root, change.key)
  else root = remove(root!, change.key, change.kind === 'successor')
  visit(root)
  return { root: root!.key, visits, trace }
}

export function traceSearch(values: number[], target: number, binary: boolean) {
  let left = 0
  let right = values.length - 1
  let found = -1
  const inspected: number[] = []
  const trace: string[] = []
  while (left <= right) {
    const index = binary ? left + Math.floor((right - left) / 2) : left
    const value = values[index]
    inspected.push(value)
    trace.push(`Se examina el índice ${index}, valor ${value}.`)
    if (value === target) { found = index; break }
    if (!binary || value < target) left = index + 1
    else right = index - 1
  }
  trace.push(found < 0 ? 'La clave no aparece.' : `La clave aparece en el índice ${found}.`)
  return { inspected, found, trace }
}

export function traceInsertion(input: number[]) {
  const values = [...input]
  const trace: string[] = []
  let firstPass: number[] = []
  let comparisons = 0
  let swaps = 0
  for (let i = 1; i < values.length; i++) {
    for (let j = i; j > 0; j--) {
      comparisons++
      const swap = values[j] < values[j - 1]
      trace.push(`Se compara ${values[j]} con ${values[j - 1]}. ${swap ? 'Se intercambian.' : 'Se detiene la pasada.'}`)
      if (!swap) break
      const previous = values[j - 1]
      values[j - 1] = values[j]
      values[j] = previous
      swaps++
    }
    if (i === 1) firstPass = [...values]
    trace.push(`Al terminar la pasada ${i} queda ${list(values)}.`)
  }
  return { values, firstPass, comparisons, swaps, trace }
}

export function describeAlgorithm(profile: AlgorithmProfile, [first, second]: string[]): PredictionExercise {
  switch (profile.kind) {
    case 'discipline': {
      const input = profile.sequences.find(row => row.label === second)!.values
      const result = traceDiscipline(first === 'Pila' ? 'stack' : 'queue', input)
      return {
        facts: [
          'La estructura empieza vacía. Las operaciones son ' + input.map(op => op === 'remove' ? 'retirar' : `insertar ${op}`).join(', ') + '.',
          'Escribe las secuencias con comas o espacios y usa un guion si no contienen valores.',
        ],
        answers: [sequence('Valores retirados en orden', result.removed),
          sequence('Valores pendientes de abajo a arriba o de frente a final', result.pending), quantity('Retiradas en vacío', result.empty)],
        steps: ['Aplica la disciplina de retirada indicada. Retirar en vacío no elimina ningún valor.'],
        trace: result.trace,
      }
    }
    case 'tree': {
      const root = profile.keys[0]
      const changes: TreeChange[] = [
        { kind: 'insert', key: profile.add }, { kind: 'successor', key: root },
        { kind: 'predecessor', key: root }, { kind: 'successor', key: profile.remove },
      ]
      const change = changes[algorithmControls(profile)[0].options.indexOf(first)]
      const result = traceTree(profile.keys, change, second as Order)
      return {
        facts: [`Construye un árbol binario de búsqueda insertando ${list(profile.keys)}. Aplica el cambio y después el recorrido.`],
        answers: [quantity('Raíz final', result.root), sequence('Claves visitadas en orden', result.visits)],
        steps: ['La comparación determina la rama. El recorrido determina cuándo se visita cada raíz.'],
        trace: result.trace,
      }
    }
    case 'comparison': {
      const sort = profile.sorts.find(row => sortLabel(row.label) === first)
      if (sort) {
        const result = traceInsertion(sort.values)
        return {
          facts: [`Ordena ${list(sort.values)} por inserción con intercambios adyacentes. Cuenta cada comparación de claves, incluida la que detiene la pasada.`],
          answers: [sequence('Estado tras la primera pasada', result.firstPass), quantity('Comparaciones de claves', result.comparisons),
            quantity('Intercambios', result.swaps)],
          steps: ['La comprobación del límite del array no cuenta como comparación de claves.'],
          trace: result.trace,
        }
      }
      const target = first === searchCases[2] ? profile.absent : profile.present
      const result = traceSearch(profile.sorted, target, first !== searchCases[0])
      return {
        facts: [`Busca ${target} en ${list(profile.sorted)}. La búsqueda binaria usa extremos inclusivos y redondea el índice medio hacia abajo.`],
        answers: [sequence('Valores examinados en orden', result.inspected), quantity('Posiciones examinadas', result.inspected.length),
          { label: '¿Se encuentra la clave?', expected: result.found < 0 ? 'No' : 'Sí', options: ['Sí','No'] }],
        steps: ['Cuenta una posición cada vez que se examina un elemento.'],
        trace: result.trace,
      }
    }
  }
}
