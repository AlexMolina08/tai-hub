import { expect, it } from 'vitest'
import { samplePackage } from './fixtures.test-support'
import { gradeChoice } from './grading'

it('records an omitted choice without revealing its solution or grading an unanswered option', () => {
  const activity = samplePackage().activities[0]
  if (activity.kind !== 'choice') throw Error('Choice fixture required')
  const result = gradeChoice(activity, null)
  expect(result.outcome).toBe('omitted')
  expect(result.feedback).not.toContain(activity.solution)
  expect(gradeChoice(activity, 'a').outcome).toBe('correct')
  expect(gradeChoice(activity, 'b').outcome).toBe('incorrect')
  expect(() => gradeChoice(activity, 'not-an-option')).toThrow()
})
