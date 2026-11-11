import type { Activity, LabEvent, LabPackage, Lesson } from './model'

export interface StudyContinuation {
  pack: LabPackage
  lesson: Lesson
  activity: Activity
  activityIndex: number
  savedAt: string
}

/** Resume only an exact content version present in this account's study library.
 * Timestamp order is a navigation convenience, never a merge rule or mastery signal.
 * Conflicting drafts remain intact and are resolved by the activity view.
 */
export function studyContinuation(packages: LabPackage[], events: LabEvent[], accountId: string): StudyContinuation | undefined {
  const destinations = new Map<string, Omit<StudyContinuation, 'savedAt'>>()
  for (const pack of packages) {
    const activities = new Map(pack.activities.map(activity => [activity.id, activity]))
    for (const lesson of pack.lessons) {
      if (lesson.state !== 'validated') continue
      lesson.activityIds.forEach((id, activityIndex) => {
        const activity = activities.get(id)
        if (!activity || activity.state !== 'validated' || activity.provenance.status !== 'eligible'
          || (activity.phase !== 'practice' && activity.phase !== 'immediate')) return
        const key = JSON.stringify([pack.id, pack.version, activity.id, activity.version])
        if (!destinations.has(key)) destinations.set(key, { pack, lesson, activity, activityIndex })
      })
    }
  }
  const candidates = events.filter(event => event.accountId === accountId && event.kind !== 'exposure' && event.kind !== 'session-position')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
  for (const event of candidates) {
    if (event.kind === 'exposure' || event.kind === 'session-position') continue
    const destination = destinations.get(JSON.stringify([event.packageId, event.packageVersion, event.activityId, event.activityVersion]))
    if (destination) return { ...destination, savedAt: event.createdAt }
  }
}

export const activityLocationKey = (accountId: string, pack: LabPackage, lesson: Lesson) =>
  JSON.stringify(['tai-lab-activity', accountId, pack.id, pack.version, lesson.id])
