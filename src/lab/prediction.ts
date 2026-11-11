export type PredictionControl = { label: string; options: string[]; initial: string; toggle?: true }
export type PredictionAnswer = {
  label: string
  expected: string
  options?: string[]
  format?: 'sequence' | 'hex' | 'hex-or-dash' | 'integer' | 'fraction'
}
export type PredictionExercise = {
  facts: string[]
  answers: PredictionAnswer[]
  steps: string[]
  points?: [number, number][]
}

export function parsePredictionDraft(raw: string, schema: PredictionControl[], describe: (values: string[]) => PredictionExercise) {
  let value: { controls?: unknown; answers?: unknown } | undefined
  try { value = JSON.parse(raw) } catch { value = undefined }
  const choices = Array.isArray(value?.controls) ? value.controls : []
  const predictions = Array.isArray(value?.answers) ? value.answers : []
  const valid = choices.length === schema.length && schema.every((control, i) => control.options.includes(choices[i]))
  const controls = valid ? choices as string[] : schema.map(control => control.initial)
  const answers = describe(controls).answers.map((_, i) =>
    valid && typeof predictions[i] === 'string' && predictions[i].length <= 40 ? predictions[i] : '')
  return { controls, answers }
}

function normalize(answer: PredictionAnswer, raw: string): string | undefined {
  if (answer.options) return answer.options.includes(raw) ? raw : undefined
  const text = raw.trim().toUpperCase()
  switch (answer.format) {
    case 'sequence': {
      const sequence = text.replace(/[\s,]+/g, '')
      return /^[A-Z0-9]+$|^-$/.test(sequence) ? sequence : undefined
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
