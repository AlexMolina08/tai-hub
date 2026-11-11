import type { Activity } from './model'

/** Apply across the entire private library, including older versions, before importing a new package. */
export function familyConflicts(activities: Activity[]): string[] {
  const partitions = new Map<string, Set<string>>()
  for (const activity of activities) {
    const partition = activity.phase === 'delayed' && activity.evaluationIntent === 'retention' ? 'training'
      : ['reserved', 'delayed'].includes(activity.phase) ? activity.phase : 'training'
    for (const key of [`family:${activity.familyId}`, `scenario:${activity.scenarioId}`]) {
      const values = partitions.get(key) ?? new Set<string>()
      values.add(partition); partitions.set(key, values)
    }
  }
  return [...partitions].filter(([, values]) => values.size > 1).map(([key]) => `${key}: cruce entre entrenamiento y reserva`)
}
