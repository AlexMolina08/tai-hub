import { expect, it } from 'vitest'
import { matchesPredictionAnswer, parsePredictionDraft, validPredictionAnswer } from './prediction'
import { describeStack, stackControls, traceStack } from './stack-model'

it('keeps distinct frame identities for the same Fibonacci argument', () => {
  const { value, total, maximum, events } = traceStack('fibonacci', 3)
  expect([value, total, maximum]).toEqual([2, 5, 3])
  expect(events.map(({ type, frame, active }) => [type, frame.id, frame.argument, active.map(row => row.id)])).toEqual([
    ['entry', 1, 3, [1]], ['entry', 2, 2, [1, 2]], ['entry', 3, 1, [1, 2, 3]], ['return', 3, 1, [1, 2]],
    ['entry', 4, 0, [1, 2, 4]], ['return', 4, 0, [1, 2]], ['return', 2, 2, [1]],
    ['entry', 5, 1, [1, 5]], ['return', 5, 1, [1]], ['return', 1, 3, []],
  ])
})

it('accepts signed lists and checks order and duplicates', () => {
  const model = describeStack(['Suma con paso de dos', '5'])
  expect(model.answers.map(a => a.expected)).toEqual(['5, 3, 1, -1', '-1, 1, 3, 5', '4', '4', '9'])
  expect(matchesPredictionAnswer(model.answers[0], '5 3 1 -1')).toBe(true)
  expect(matchesPredictionAnswer(model.answers[0], '5,3,-1,1')).toBe(false)
  expect(matchesPredictionAnswer(model.answers[0], '5 3 1')).toBe(false)
  expect(validPredictionAnswer(model.answers[0], '5,,3,1,-1')).toBe(false)
  expect(describeStack(['Suma con paso de dos', '0']).answers.map(a => a.expected)).toEqual(['0', '0', '1', '1', '0'])
  expect(() => traceStack('fibonacci', 9)).toThrow(RangeError)
  expect(() => traceStack('fibonacci', 2.5)).toThrow(RangeError)
})

it('keeps all 67 arguments and bounds the separate trace cursor', () => {
  const controls = ['Fibonacci sin memoria', '8']
  const exercise = describeStack(controls)
  const answers = exercise.answers.map(a => a.expected)
  expect(answers.slice(2)).toEqual(['8', '67', '21'])
  expect(answers[0].split(', ')).toHaveLength(67)
  expect(exercise.trace).toHaveLength(134)
  const parse = (step: number) => parsePredictionDraft(JSON.stringify({ controls, answers, step }), stackControls, describeStack)
  expect(parse(133)).toEqual({ controls, answers, step: 133 })
  expect(parse(134)).toEqual({ controls, answers })
  expect(parse(-1)).toEqual({ controls, answers })
  expect(matchesPredictionAnswer(exercise.answers[0], answers[0])).toBe(true)
})
