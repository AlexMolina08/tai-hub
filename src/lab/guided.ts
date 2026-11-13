import type { GuidedSession, LabEvent, LabPackage, SessionPosition } from './model'

export const sessionMinutes = (session: GuidedSession) => session.stages.reduce((total, stage) => total + stage.minutes, 0)

/** Assistance remains visible even when it was requested after an answer or without answering. */
export function sessionAssistance(pack: LabPackage, session: GuidedSession, events: LabEvent[], accountId: string): Set<string> {
  const ids = new Set(session.stages.flatMap(stage => stage.activityIds))
  return new Set(events.filter((event): event is Extract<LabEvent, { kind: 'attempt' | 'assistance' }> => (event.kind === 'attempt' || event.kind === 'assistance')
    && event.accountId === accountId && event.packageId === pack.id && event.packageVersion === pack.version
    && ids.has(event.activityId) && pack.activities.some(activity => activity.id === event.activityId && activity.version === event.activityVersion)
    && (event.hintCount > 0 || event.solutionViewed)).map(event => event.activityId))
}

export interface SessionResume { pack: LabPackage; session: GuidedSession; position: SessionPosition }

/** A completed session supersedes earlier unfinished positions for the same edition. */
export function sessionPositions(packages: LabPackage[], events: LabEvent[], accountId: string): SessionResume[] {
  const latest = new Map<string, SessionResume>()
  const positions = events.filter((event): event is SessionPosition => event.kind === 'session-position' && event.accountId === accountId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
  for (const position of positions) {
    const pack = packages.find(pack => pack.id === position.packageId && pack.version === position.packageVersion)
    const session = pack?.sessions?.find(session => session.id === position.sessionId && session.version === position.sessionVersion && session.state === 'validated')
    const stage = session?.stages.find(stage => stage.id === position.stageId)
    if (!pack || !session || !stage || (position.activityId !== null && !stage.activityIds.includes(position.activityId))
      || (position.completed && (stage.kind !== 'close' || position.activityId !== null))) continue
    const key = JSON.stringify([pack.id, pack.version, session.id, session.version])
    if (!latest.has(key)) latest.set(key, { pack, session, position })
  }
  return [...latest.values()]
}

export function sessionResume(packages: LabPackage[], events: LabEvent[], accountId: string): SessionResume | undefined {
  return sessionPositions(packages, events, accountId).find(({ position }) => !position.completed)
}
