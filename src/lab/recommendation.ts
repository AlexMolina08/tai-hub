import type { Activity, LabEvent, LabPackage, Lesson } from './model'
import type { LearningInput, LearningSnapshot } from './learning'
import { learningObjectiveKey } from './learning'
import { sessionResume } from './guided'
import { draftHeads, draftKey } from './history'
import { isBasicTechnologyTopic } from './study-scope'

export type LearningDestination = { packageId: string; packageVersion: string } & (
  { kind: 'lesson'; lessonId: string; activityId?: string }
  | { kind: 'activity'; activityId: string; attemptGroupId?: string }
  | { kind: 'session'; sessionId: string; positionId: string })
export interface LearningRecommendation {
  id: string
  target: LearningDestination
  title: string
  reason: 'resume' | 'prerequisite' | 'critical-error' | 'due' | 'continue' | 'transfer' | 'balance-iv'
  message: string
  evidenceIds: string[]
  objectiveKeys: string[]
  block: 'II' | 'III' | 'IV' | 'other'
}
export interface RecommendationResult { items: LearningRecommendation[]; limitations: string[]; reserveExhausted: boolean }
interface Candidate extends LearningRecommendation { rank: number; review: boolean }
export interface RecommendationInput {
  packages: readonly LabPackage[]
  currentEditions?: readonly LabPackage[]
  events: readonly LabEvent[]
  learning: LearningSnapshot
  skipped?: readonly string[]
  limit?: number
  /** Editorial equivalences, never automatically inferred from wording. */
  equivalences?: LearningInput['equivalences']
}
const dayMs = 86_400_000
export const recommendationId = (target: LearningDestination) => JSON.stringify([target.packageId, target.packageVersion, target.kind,
  target.kind === 'lesson' ? target.lessonId : target.kind === 'activity' ? target.activityId : target.sessionId])
const ownRef = (event: LabEvent, pack: LabPackage) => 'packageId' in event && event.packageId === pack.id && event.packageVersion === pack.version
const blockOf = (topics: string[]): LearningRecommendation['block'] => topics.some(id => id.startsWith('III.')) ? 'III'
  : topics.some(id => id.startsWith('IV.')) ? 'IV' : topics.some(isBasicTechnologyTopic) ? 'II' : 'other'

/** A bounded, explainable queue. The queue never changes mastery or blocks free exploration. */
export function recommendLearning(input: RecommendationInput): RecommendationResult {
  const { learning, packages } = input, now = Date.parse(learning.evaluatedAt)
  const events = input.events.filter(event => event.accountId === learning.accountId)
  const objectives = new Map(learning.objectives.map(objective => [objective.key, objective]))
  const candidates: Candidate[] = [], limitations = new Set<string>()
  const validActivity = (pack: LabPackage, activity: Activity) => activity.state === 'validated' && activity.provenance.status === 'eligible'
    && activity.objectiveIds.every(id => pack.objectives.some(objective => objective.id === id && objective.state === 'validated'))
  const validLesson = (pack: LabPackage, lesson: Lesson) => lesson.state === 'validated'
    && lesson.objectiveIds.every(id => pack.objectives.some(objective => objective.id === id && objective.state === 'validated'))
    && lesson.activityIds.every(id => pack.activities.some(activity => activity.id === id && validActivity(pack, activity)))
  const scope = (pack: LabPackage, ids: string[]) => ({
    objectiveKeys: ids.map(id => learningObjectiveKey(pack.id, pack.version, id)),
    block: blockOf(pack.objectives.filter(objective => ids.includes(objective.id)).map(objective => objective.topicId)),
  })
  const add = (pack: LabPackage, target: LearningDestination, title: string, ids: string[], reason: Candidate['reason'],
    message: string, rank: number, evidenceIds: string[] = [], review = false) => candidates.push({ id: recommendationId(target),
    target, title, reason, message, rank, evidenceIds, review, ...scope(pack, ids) })
  const activityTarget = (pack: LabPackage, activity: Activity, attemptGroupId?: string): LearningDestination => ({ packageId: pack.id, packageVersion: pack.version,
    kind: 'activity', activityId: activity.id, ...(attemptGroupId ? { attemptGroupId } : {}) })
  const lessonTarget = (pack: LabPackage, lesson: Lesson, activityId?: string): LearningDestination => ({ packageId: pack.id,
    packageVersion: pack.version, kind: 'lesson', lessonId: lesson.id, ...(activityId ? { activityId } : {}) })

  const guided = sessionResume([...packages], events, learning.accountId)
  if (guided) add(guided.pack, { kind: 'session', packageId: guided.pack.id, packageVersion: guided.pack.version,
    sessionId: guided.session.id, positionId: guided.position.id }, guided.session.title, guided.session.objectiveIds,
  'resume', 'Tu sesión todavía está abierta. Continúa desde la etapa guardada.', 0, [guided.position.id])

  // Dates choose a navigation convenience only. A completed answer is not itself unfinished work.
  const draftKeys = new Set(events.filter(event => event.kind === 'draft').map(draftKey))
  const drafts = [...draftKeys].flatMap(key => draftHeads(events, key)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))
  for (const draft of drafts) {
    const pack = packages.find(pack => ownRef(draft, pack))
    const activity = pack?.activities.find(activity => activity.id === draft.activityId && activity.version === draft.activityVersion)
    const lesson = pack?.lessons.find(lesson => lesson.activityIds.includes(draft.activityId) && validLesson(pack, lesson))
    if (!pack || !activity || !validActivity(pack, activity)) continue
    const attempts = events.filter(event => event.kind === 'attempt' && ownRef(event, pack) && event.activityId === activity.id
      && event.activityVersion === activity.version && event.attemptGroupId === draft.attemptGroupId)
    const presented = events.some(event => event.kind === 'learning-context' && event.action === 'present'
      && event.target.kind === 'activity' && event.target.packageId === pack.id && event.target.packageVersion === pack.version
      && event.target.activityId === activity.id && event.target.activityVersion === activity.version
      && event.target.attemptGroupId === draft.attemptGroupId)
    // Opening a reserve exposes its family even before the learner selects an answer.
    // Preserve that presentation rather than leaving it unreachable or starting a new group.
    if (attempts.length || !draft.value.trim() && (lesson || !presented)) continue
    add(pack, lesson ? lessonTarget(pack, lesson, activity.id) : activityTarget(pack, activity, draft.attemptGroupId),
      lesson && activity.phase === 'practice' ? activity.title : 'Ejercicio pendiente', activity.objectiveIds, 'resume',
      'Retoma el ejercicio desde la respuesta guardada.', 0, [draft.id])
    break
  }

  const seenFamilies = new Set(events.flatMap(event => 'familyId' in event ? [event.familyId] : []))
  for (const equivalent of input.equivalences?.families ?? []) if (equivalent.some(id => seenFamilies.has(id))) equivalent.forEach(id => seenFamilies.add(id))
  // Follow transitive editorial unions without depending on their supplied order.
  for (let changed = true; changed;) {
    changed = false
    for (const equivalent of input.equivalences?.families ?? []) if (equivalent.some(id => seenFamilies.has(id))) for (const id of equivalent) {
      if (!seenFamilies.has(id)) { seenFamilies.add(id); changed = true }
    }
  }
  const exposedActivities = packages.flatMap(pack => pack.activities.filter(activity => seenFamilies.has(activity.familyId)))
  const seenScenarios = new Set(exposedActivities.map(activity => activity.scenarioId))
  const seenOriginals = new Set(exposedActivities.flatMap(activity => activity.provenance.originalId ? [activity.provenance.originalId] : []))
  const expand = (seen: Set<string>, groups: readonly (readonly string[])[] = []) => {
    for (let changed = true; changed;) {
      changed = false
      for (const group of groups) if (group.some(id => seen.has(id))) for (const id of group) {
        if (!seen.has(id)) { seen.add(id); changed = true }
      }
    }
  }
  expand(seenScenarios, input.equivalences?.scenarios)
  expand(seenOriginals, input.equivalences?.originals)
  const before = (ancestor: string, descendant: string) => {
    const byId = new Map(events.filter(event => event.kind === 'learning-context').map(event => [event.id, event]))
    const todo = [...(byId.get(descendant)?.parentIds ?? [])], seen = new Set<string>()
    for (let index = 0; index < todo.length; index++) {
      const id = todo[index]
      if (id === ancestor) return true
      if (seen.has(id)) continue
      seen.add(id); todo.push(...(byId.get(id)?.parentIds ?? []))
    }
    return false
  }
  const fresh = (activity: Activity) => !seenFamilies.has(activity.familyId) && !seenScenarios.has(activity.scenarioId)
    && (!activity.provenance.originalId || !seenOriginals.has(activity.provenance.originalId))
  let reserves = 0, freshReserves = 0

  for (const pack of input.currentEditions ?? packages) {
    const lessons = pack.lessons.filter(lesson => validLesson(pack, lesson))
    const answered = new Set(events.filter(event => event.kind === 'attempt' && ownRef(event, pack) && event.outcome !== 'omitted'
      && pack.activities.some(activity => activity.id === event.activityId && activity.version === event.activityVersion)).map(event => 'activityId' in event ? event.activityId : ''))
    const nextLesson = lessons.find(lesson => lesson.activityIds.some(id => !answered.has(id)))
    if (nextLesson) {
      // Only prerequisites of the next available lesson are relevant. Cycles never lock the catalogue.
      const queue = [...nextLesson.prerequisites], visited = new Set<string>()
      for (let index = 0; index < queue.length; index++) {
        const id = queue[index]
        if (visited.has(id)) continue
        visited.add(id)
        const progress = objectives.get(learningObjectiveKey(pack.id, pack.version, id))
        if (progress?.status === 'consolidated') continue
        const prerequisite = lessons.find(lesson => lesson.objectiveIds.includes(id) && lesson.id !== nextLesson.id)
        if (!prerequisite) { limitations.add('Algún prerrequisito aún no tiene una lección validada disponible. Puedes continuar explorando.'); continue }
        add(pack, lessonTarget(pack, prerequisite), prerequisite.title, prerequisite.objectiveIds, 'prerequisite',
          `Puede ayudarte antes de «${nextLesson.title}». Puedes elegir otra lección.`, 1)
        queue.push(...prerequisite.prerequisites.filter(parent => !visited.has(parent)))
      }
    }
    for (const lesson of lessons.filter(lesson => lesson.activityIds.some(id => !answered.has(id)))) {
      add(pack, lessonTarget(pack, lesson, lesson.activityIds.find(id => !answered.has(id))), lesson.title, lesson.objectiveIds, 'continue',
        'Continúa una lección con actividades pendientes.', 4)
    }
    for (const objective of learning.objectives.filter(objective => objective.packageId === pack.id && objective.packageVersion === pack.version)) {
      const activities = pack.activities.filter(activity => activity.objectiveIds.includes(objective.objectiveId) && validActivity(pack, activity))
      const critical = objective.reviews.filter(review => review.open && review.severity === 'critical')
      for (const review of critical) {
        const error = learning.attempts.find(attempt => attempt.attemptId === review.attemptId)
        const errorFamilies = new Set(error ? [error.familyId] : [])
        expand(errorFamilies, input.equivalences?.families)
        const rechecks = activities.filter(activity => (activity.phase === 'practice' || activity.phase === 'immediate')
          && review.diagnosticId && activity.learning?.rechecksDiagnosticIds.includes(review.diagnosticId)
          && !errorFamilies.has(activity.familyId))
        const recovered = rechecks.some(activity => learning.attempts.some(attempt => attempt.ref.packageId === pack.id
          && attempt.ref.packageVersion === pack.version && attempt.ref.activityId === activity.id && attempt.ref.activityVersion === activity.version
          && attempt.eligibility === 'eligible' && attempt.first && attempt.unaided && objective.qualifyingCorrectIds.includes(attempt.attemptId)
          && !!attempt.contextId && !!error?.contextId && before(error.contextId, attempt.contextId)))
        if (recovered) limitations.add('Ya hay una recuperación sin ayuda de un error crítico. Falta la comprobación diferida; repetir ahora el mismo ejercicio no la sustituye.')
        else if (rechecks[0]) add(pack, activityTarget(pack, rechecks[0]), 'Ejercicio de refuerzo', rechecks[0].objectiveIds, 'critical-error',
          'Practica con otro ejercicio sobre un concepto que conviene repasar.', 2, [review.attemptId], true)
        else {
          const lesson = lessons.find(lesson => lesson.objectiveIds.includes(objective.objectiveId))
          if (lesson) add(pack, lessonTarget(pack, lesson), lesson.title, lesson.objectiveIds, 'critical-error',
            'Revisa la explicación de un concepto con un error crítico pendiente.', 2, [review.attemptId], true)
          limitations.add('Un error crítico sigue pendiente hasta disponer de sus comprobaciones específicas en otra familia. Leer la lección no lo resuelve por sí solo.')
        }
      }
      if (objective.schedule?.overdue) {
        const activity = activities.find(activity => activity.phase === 'delayed'
          && (!critical.length || critical.every(review => review.diagnosticId && activity.learning?.rechecksDiagnosticIds.includes(review.diagnosticId))))
        if (activity) add(pack, activityTarget(pack, activity), 'Ejercicio de repaso', activity.objectiveIds, 'due',
          'Ya puedes comprobar si recuerdas lo que estudiaste.', 3,
          [...objective.qualifyingCorrectIds, ...objective.reviews.filter(review => review.open).map(review => review.attemptId)], true)
        else limitations.add('Hay un repaso pendiente sin actividad diferida validada disponible todavía.')
      }
      const reserved = activities.filter(activity => activity.phase === 'reserved' || activity.phase === 'delayed' && activity.evaluationIntent === 'transfer')
      reserves += reserved.length; freshReserves += reserved.filter(fresh).length
      const transfer = reserved.find(activity => fresh(activity) && (activity.phase === 'reserved' || objective.schedule?.overdue))
      if (transfer && objective.qualifyingCorrectIds.length && !critical.length) {
        const theory = isBasicTechnologyTopic(objective.topicId)
        add(pack, activityTarget(pack, transfer), theory ? 'Pregunta de aplicación' : 'Supuesto nuevo',
          transfer.objectiveIds, 'transfer', theory ? 'Aplica el concepto en una pregunta nueva.' : 'Aplica lo que has estudiado a un supuesto distinto.', 5)
      }
    }
  }

  const contacts = learning.contacts.map(contact => ({ ...contact,
    block: blockOf(learning.objectives.filter(objective => objective.packageId === contact.packageId
      && objective.packageVersion === contact.packageVersion && contact.objectiveIds.includes(objective.objectiveId)).map(objective => objective.topicId)),
  }))
  const usable = contacts.filter(contact => contact.usableTime && contact.block !== 'other')
  const timesIII = usable.filter(contact => contact.block === 'III').map(contact => Date.parse(contact.createdAt))
  const timesIV = usable.filter(contact => contact.block === 'IV').map(contact => Date.parse(contact.createdAt))
  const lastIV = timesIV.length ? Math.max(...timesIV) : timesIII.length ? Math.min(...timesIII) : now
  const completeTimes = contacts.every(contact => contact.usableTime && contact.block !== 'other')
  const weekWithoutIV = completeTimes && now - lastIV >= 7 * dayMs && timesIII.some(time => time >= lastIV)
  // Causal order, rather than device dates, permits balancing after an old unresolved contact.
  const otherContacts = contacts.filter(contact => contact.block !== 'III')
  const onlyIII = contacts.filter(contact => contact.block === 'III'
    && contacts.filter(other => other.studySessionId === contact.studySessionId).every(other => other.block === 'III')
    && otherContacts.every(other => before(other.contextId, contact.contextId)))
  const sessionsWithoutIV = new Set(onlyIII.map(contact => contact.studySessionId)).size >= 5
  if (!completeTimes && contacts.length) limitations.add('Hay contactos con fecha o edición incompleta. No se puede afirmar cuánto tiempo llevas sin practicar un bloque.')
  if (weekWithoutIV || sessionsWithoutIV) {
    const available = candidates.filter(candidate => candidate.block === 'IV' && candidate.reason !== 'resume').sort((a, b) => a.rank - b.rank)[0]
    if (available) candidates.push({ ...available, rank: 0.5, reason: 'balance-iv', message: weekWithoutIV
      ? 'Has registrado estudio de III y al menos siete días sin actividad de IV. Retoma este bloque.'
      : 'Hay al menos cinco sesiones de III posteriores al último contacto registrado con otro bloque o de alcance desconocido. Alterna con IV.' })
    else limitations.add('Conviene retomar IV, pero no hay una propuesta validada disponible. El mapa conserva todos sus temas.')
  }
  const skipped = new Set(input.skipped ?? []), chosen: Candidate[] = [], used = new Set<string>(), objectiveCounts = new Map<string, number>()
  const preferences = candidates.some(candidate => candidate.block === 'II' && !skipped.has(candidate.id))
    ? ['III', 'IV', 'II', 'III', 'IV'] : ['III', 'IV', 'III', 'III', 'IV']
  let reviewCount = 0
  while (chosen.length < Math.min(8, Math.max(1, input.limit ?? 8))) {
    const preference = preferences[chosen.length % preferences.length]
    const remaining = candidates.filter(candidate => !used.has(candidate.id) && !skipped.has(candidate.id)
      && (!candidate.review || reviewCount < 4) && candidate.objectiveKeys.every(key => (objectiveCounts.get(key) ?? 0) < 2))
      .sort((a, b) => a.rank - b.rank || Number(b.block === preference) - Number(a.block === preference) || a.id.localeCompare(b.id))
    const next = remaining[0]
    if (!next) break
    chosen.push(next); used.add(next.id)
    if (next.review) reviewCount++
    next.objectiveKeys.forEach(key => objectiveCounts.set(key, (objectiveCounts.get(key) ?? 0) + 1))
  }
  const reserveExhausted = reserves > 0 && freshReserves === 0
  if (reserveExhausted) limitations.add('Las reservas disponibles ya figuran como expuestas. Repetirlas sirve para repasar, sin aportar transferencia inédita.')
  return { items: chosen.map(({ rank: _rank, review: _review, ...item }) => item), limitations: [...limitations], reserveExhausted }
}
