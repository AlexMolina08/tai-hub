import type { ChoiceActivity, LabEvent } from './model'

export function gradeChoice(activity: ChoiceActivity, answer: string | null) {
  if (answer === null) return { outcome: 'omitted' as const, feedback: 'Sin respuesta. ' + activity.solution }
  const selected = activity.options.find(o => o.id === answer)
  if (!selected) throw new Error('La opción no pertenece a esta versión de la actividad.')
  return { outcome: selected.correct ? 'correct' as const : 'incorrect' as const, feedback: selected.explanation }
}
export function assistanceFor(events: LabEvent[], groupId: string) {
  const matching = events.filter(e => (e.kind === 'assistance' || e.kind === 'attempt') && e.attemptGroupId === groupId)
  return matching.reduce((state, e) => {
    if (e.kind !== 'assistance' && e.kind !== 'attempt') return state
    return { hintCount: Math.max(state.hintCount, e.hintCount), solutionViewed: state.solutionViewed || e.solutionViewed }
  }, { hintCount: 0, solutionViewed: false })
}
