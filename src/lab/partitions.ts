import type { Activity, LabPackage } from './model'

/** Apply across the entire private library, including older versions, before importing a new package. */
export function familyConflicts(activities: Activity[], packages: Pick<LabPackage, 'id' | 'exams'>[] = []): string[] {
  const partitions = new Map<string, Set<string>>()
  function add(partition: string, familyId: string, scenarioId: string, originalId?: string) {
    for (const key of [`family:${familyId}`, `scenario:${scenarioId}`, ...(originalId ? [`original:${originalId}`] : [])]) {
      const values = partitions.get(key) ?? new Set<string>()
      values.add(partition)
      partitions.set(key, values)
    }
  }
  for (const activity of activities) {
    const partition = activity.phase === 'delayed' && activity.evaluationIntent === 'retention' ? 'training'
      : ['reserved', 'delayed'].includes(activity.phase) ? activity.phase : 'training'
    add(partition, activity.familyId, activity.scenarioId, activity.provenance.originalId)
  }
  for (const pack of packages) for (const form of pack.exams ?? []) for (const section of form.sections) {
    const partition = form.partition === 'training' ? 'training' : JSON.stringify(['exam', pack.id, form.id])
    for (const question of [...section.questions, ...section.reserves]) {
      add(partition, question.familyId, question.scenarioId, question.provenance.originalId)
    }
  }
  return [...partitions].filter(([, values]) => values.size > 1).map(([key]) => `${key}: cruce entre entrenamiento y reserva`)
}
