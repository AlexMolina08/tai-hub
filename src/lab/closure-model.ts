import type { PredictionControl, PredictionExercise } from './prediction'

export const CLOSURE_MODEL_VERSION = 'closure-model-v1'
export type Dependency = { from: string[]; to: string[] }
export type ClosureProfile = {
  kind: 'closure' | 'keys'
  attributes: string[]
  dependencies: Dependency[]
  initial: string[]
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const unique = (value: unknown): value is string[] => Array.isArray(value)
  && value.every(item => typeof item === 'string' && /^[A-Z]$/.test(item)) && new Set(value).size === value.length
const subset = (values: string[], universe: string[]) => values.every(item => universe.includes(item))
const compact = (values: string[]) => [...values].sort().join('') || '-'
const ruleText = (rule: Dependency) => `${compact(rule.from)} → ${compact(rule.to)}`
const automatic = 'Orden automático'

export function validClosureProfile(value: unknown): value is ClosureProfile {
  if (!record(value)) return false
  const { kind, attributes, initial, dependencies } = value
  return (kind === 'closure' || kind === 'keys') && unique(attributes) && attributes.length >= 2 && attributes.length <= 6
    && unique(initial) && subset(initial, attributes) && Array.isArray(dependencies)
    && dependencies.length >= 1 && dependencies.length <= 6
    && dependencies.every(rule => record(rule) && unique(rule.from) && unique(rule.to) && rule.to.length > 0
      && subset(rule.from, attributes) && subset(rule.to, attributes))
    && new Set(dependencies.map(ruleText)).size === dependencies.length
}

export function attributeClosure(initial: string[], dependencies: Dependency[], manual: Dependency[] = []) {
  const values = new Set(initial)
  const steps = [`Conjunto inicial ${compact([...values])}.`]
  const additions = (rule: Dependency) =>
    rule.from.every(value => values.has(value)) ? rule.to.filter(value => !values.has(value)) : []
  function apply(rule: Dependency, extra: string[]) {
    for (const value of extra) values.add(value)
    steps.push(`Con ${ruleText(rule)} se añade ${compact(extra)}. El conjunto pasa a ${compact([...values])}.`)
  }
  for (const rule of manual) {
    const extra = additions(rule)
    if (extra.length) apply(rule, extra)
    else if (rule.from.some(value => !values.has(value)))
      steps.push(`${ruleText(rule)} aún no se puede aplicar. Falta un atributo de su lado izquierdo.`)
    else steps.push(`${ruleText(rule)} no añade atributos. Su lado derecho ya está incluido.`)
  }
  for (;;) {
    const available = dependencies.find(rule => additions(rule).length > 0)
    if (!available) break
    apply(available, additions(available))
  }
  const closure = [...values].sort()
  steps.push(`Ninguna regla añade más atributos. El cierre es ${compact(closure)}.`)
  return { closure, steps }
}

export function candidateKeys(attributes: string[], dependencies: Dependency[]) {
  const sets = Array.from({ length: 2 ** attributes.length }, (_, mask) =>
    attributes.filter((_, index) => (mask & (1 << index)) !== 0)).sort((a,b) => a.length-b.length)
  const keys: string[][] = []
  for (const set of sets) {
    if (!keys.some(key => subset(key, set)) && attributeClosure(set, dependencies).closure.length === attributes.length) keys.push(set)
  }
  return keys
}

export function closureControls(profile: ClosureProfile): PredictionControl[] {
  return [
    ...profile.attributes.map((label): PredictionControl => ({
      label: `Incluir ${label} en el conjunto inicial`, options: ['0','1'], initial: profile.initial.includes(label) ? '1' : '0',
      toggle: true,
    })),
    ...profile.dependencies.map((_, index) => ({
      label: `Dependencia del paso manual ${index + 1}`,
      options: [automatic, ...profile.dependencies.map(ruleText)], initial: automatic,
    })),
  ]
}

export function describeClosure(profile: ClosureProfile, values: string[]): PredictionExercise {
  const start = profile.attributes.filter((_, index) => values[index] === '1')
  const manual: Dependency[] = []
  for (const selection of values.slice(profile.attributes.length)) {
    const rule = profile.dependencies.find(rule => ruleText(rule) === selection)
    if (!rule) break
    manual.push(rule)
  }
  const result = attributeClosure(start, profile.dependencies, manual)
  const superkey = result.closure.length === profile.attributes.length
  const exercise: PredictionExercise = {
    facts: [
      `Relación R(${profile.attributes.join(', ')}). Reglas ${profile.dependencies.map(ruleText).join(', ')}.`,
      'Puedes proponer el orden de varios pasos. El orden automático completa el cierre desde el punto donde lo eliges.',
      'Escribe las letras en cualquier orden, sin repetirlas. Usa el guion para el conjunto vacío.',
    ],
    answers: [
      { label: 'Cierre del conjunto inicial', expected: compact(result.closure), format: 'attribute-set' },
      { label: '¿Es superclave el conjunto inicial?', expected: superkey ? 'Sí' : 'No', options: ['Sí','No'] },
    ],
    steps: [superkey ? 'El cierre contiene todos los atributos de la relación.'
      : 'Faltan atributos de la relación en el cierre. El conjunto inicial no es superclave.'],
    trace: result.steps,
  }
  if (profile.kind === 'keys') {
    const keys = candidateKeys(profile.attributes, profile.dependencies).map(compact).sort()
    exercise.facts.push('Separa las claves candidatas con una barra / y escribe cada conjunto una vez.')
    exercise.answers.push({ label: 'Todas las claves candidatas', expected: keys.join(' / '), format: 'attribute-sets' })
    exercise.steps.push(`Claves mínimas ${keys.join(', ')}. Quitar un atributo de una clave mínima deja de cubrir toda la relación.`)
  }
  return exercise
}
