import type { Activity, PredictionActivity } from './model'

export function isPredictionActivity(activity: Activity): activity is PredictionActivity {
  return activity.kind === 'frame-model' || activity.kind === 'access-model'
    || activity.kind === 'stack-model' || activity.kind === 'relation-model' || activity.kind === 'closure-model'
    || activity.kind === 'algorithm-model'
}

export type PredictionControl = { label: string; options: string[]; initial: string; toggle?: true }
export type PredictionAnswer = {
  label: string
  expected: string
  options?: string[]
  format?: 'sequence' | 'signed-list' | 'hex' | 'hex-or-dash' | 'integer' | 'fraction' | 'attribute-set' | 'attribute-sets'
}
export type PredictionExercise = {
  facts: string[]
  answers: PredictionAnswer[]
  steps: string[]
  points?: [number, number][]
  trace?: string[]
}

export function predictionInputLimit(answer: PredictionAnswer) {
  return answer.format === 'signed-list' || answer.format === 'attribute-sets' ? 256 : 40
}

export function parsePredictionDraft(raw: string, schema: PredictionControl[], describe: (values: string[]) => PredictionExercise) {
  let value: { controls?: unknown; answers?: unknown; step?: unknown } | undefined
  try { value = JSON.parse(raw) } catch { value = undefined }
  const choices = Array.isArray(value?.controls) ? value.controls : []
  const predictions = Array.isArray(value?.answers) ? value.answers : []
  const valid = choices.length === schema.length && schema.every((control, i) => control.options.includes(choices[i]))
  const controls = valid ? choices as string[] : schema.map(control => control.initial)
  const exercise = describe(controls)
  const answers = exercise.answers.map((answer, i) =>
    valid && typeof predictions[i] === 'string' && predictions[i].length <= predictionInputLimit(answer) ? predictions[i] : '')
  const step = value?.step
  return {
    controls, answers,
    ...(valid && exercise.trace && typeof step === 'number' && Number.isInteger(step) && step >= 0
      && step < exercise.trace.length ? { step } : {}),
  }
}

function normalizeSet(text: string): string | undefined {
  if (text.trim() === '-') return '-'
  const letters = text.replace(/[\s,]+/g, '')
  return /^[A-Z]+$/.test(letters) && new Set(letters).size === letters.length ? [...letters].sort().join('') : undefined
}

function normalize(answer: PredictionAnswer, raw: string): string | undefined {
  if (answer.options) return answer.options.includes(raw) ? raw : undefined
  const text = raw.trim().toUpperCase()
  switch (answer.format) {
    case 'sequence': {
      const sequence = text.replace(/[\s,]+/g, '')
      return /^[A-Z0-9]+$|^-$/.test(sequence) ? sequence : undefined
    }
    case 'signed-list':
      if (text === '-') return text
      return text.length <= predictionInputLimit(answer) && /^-?\d{1,2}(?:(?:\s*,\s*|\s+)-?\d{1,2})*$/.test(text)
        ? text.split(/[\s,]+/).map(Number).join(',') : undefined
    case 'attribute-set': return normalizeSet(text)
    case 'attribute-sets': {
      if (text.length > predictionInputLimit(answer)) return undefined
      const sets = text.split('/').map(normalizeSet)
      return sets.every(set => set !== undefined) && new Set(sets).size === sets.length ? sets.sort().join('/') : undefined
    }
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
export function validPredictionAnswer(answer: PredictionAnswer, raw: string): boolean {
  return normalize(answer, raw) !== undefined
}
export function matchesPredictionAnswer(answer: PredictionAnswer, raw: string): boolean {
  const value = normalize(answer, raw)
  if (value === undefined) return false
  if (answer.format === 'fraction') {
    const [n, d] = value.split('/').map(Number)
    const [a, b] = answer.expected.split('/').map(Number)
    return n * b === a * d
  }
  return value === normalize(answer, answer.expected)
}
