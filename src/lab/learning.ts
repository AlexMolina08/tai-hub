import { supportsSqlGrading } from './sql-output'
import type { Activity, ActivityRef, Attempt, LabEvent, LabPackage, LearningContext } from './model'
import { canonical, mergeEvents } from './history'
import { validateLearningHistory } from './learning-context'
import { preparedDiagnosticIds } from './grading'

export interface LearningPolicy {
  version: string
  intervalDays: readonly number[]
  clockToleranceMs: number
  requiredCorrect: number
  requiredFamilies: number
  requiredDays: number
}
export const DEFAULT_LEARNING_POLICY: LearningPolicy = Object.freeze({ version: 'learning-v2-reference',
  intervalDays: Object.freeze([1, 3, 7, 14, 30]), clockToleranceMs: 5 * 60_000,
  requiredCorrect: 3, requiredFamilies: 2, requiredDays: 2 })
export interface LearningReason { code: string; message: string; evidenceIds: string[] }
export interface LearningRequirements {
  correct: { actual: number; required: number }
  families: { actual: number; required: number }
  days: { actual: number; required: number }
  delayed: boolean
  freshTransfer: boolean
  noOpenErrors: boolean
  noRelevantUncertainty: boolean
}
export interface LearningAttemptEvidence {
  attemptId: string
  ref: ActivityRef
  objectiveIds: string[]
  familyId: string
  contextId: string | null
  eligibility: 'eligible' | 'historical' | 'excluded' | 'uncertain'
  first: boolean
  unaided: boolean
  referenceSupport: 'none' | 'recorded' | 'uncertain'
  freshness: 'fresh' | 'exposed' | 'uncertain' | 'not-applicable'
  understanding: boolean
  understandingObjectiveIds: string[]
  retention: boolean
  retentionObjectiveIds: string[]
  transfer: boolean
  day: string | null
  timeStatus: 'declared-device' | 'uncertain' | 'historical'
  reasons: LearningReason[]
}
export interface LearningReview {
  attemptId: string
  diagnosticId: string | null
  severity: 'ordinary' | 'critical'
  recoveredBy: string[]
  open: boolean
}
export interface ObjectiveLearning {
  key: string
  packageId: string
  packageVersion: string
  objectiveId: string
  topicId: string
  title: string
  status: 'insufficient' | 'consolidated' | 'review-open' | 'uncertain'
  understandingIds: string[]
  retentionIds: string[]
  transferIds: string[]
  qualifyingCorrectIds: string[]
  requirements: LearningRequirements
  reviews: LearningReview[]
  schedule: { intervalDays: number; nextDelayDays?: number; dueAt: string; overdue: boolean; timeStatus: 'declared-device' | 'uncertain' } | null
  reasons: LearningReason[]
}
export interface LearningSnapshot {
  accountId: string
  policyVersion: string
  evaluatedAt: string
  objectives: ObjectiveLearning[]
  attempts: LearningAttemptEvidence[]
  dueReviews: ObjectiveLearning[]
  uncertainties: LearningReason[]
  contacts: LearningContact[]
  timeBasis: 'declared-device'
}
export interface LearningContact {
  contextId: string
  packageId: string
  packageVersion: string
  objectiveIds: string[]
  createdAt: string
  day: string
  studySessionId: string
  /** Requires exact eligible content, complete causality and no detected clock inconsistency. */
  usableTime: boolean
  reasons: LearningReason[]
}
export interface LearningInput {
  accountId: string
  packages: readonly LabPackage[]
  events: readonly LabEvent[]
  now: string
  policy: LearningPolicy
  equivalences?: { families?: readonly (readonly string[])[]; scenarios?: readonly (readonly string[])[]; originals?: readonly (readonly string[])[] }
}
export const learningObjectiveKey = (packageId: string, packageVersion: string, objectiveId: string) =>
  JSON.stringify([packageId, packageVersion, objectiveId])

const DAY = 86_400_000
const reason = (code: string, message: string, ...evidenceIds: string[]): LearningReason => ({ code, message, evidenceIds })
const packKey = (ref: Pick<ActivityRef, 'packageId' | 'packageVersion'>) => JSON.stringify([ref.packageId, ref.packageVersion])
const refOf = (a: Attempt): ActivityRef => ({ packageId: a.packageId, packageVersion: a.packageVersion, activityId: a.activityId, activityVersion: a.activityVersion })
const refKey = (ref: ActivityRef) => JSON.stringify([ref.packageId, ref.packageVersion, ref.activityId, ref.activityVersion])
function equivalence(groups: readonly (readonly string[])[] = []) {
  const roots = new Map<string, string>()
  const root = (id: string) => { let value = id; while (roots.has(value) && roots.get(value) !== value) value = roots.get(value)!; return value }
  for (const group of groups) for (const id of group.slice(1)) {
    const a = root(group[0]), b = root(id); if (a !== b) roots.set(a < b ? b : a, a < b ? a : b)
  }
  return root
}
function causalGraph(contexts: LearningContext[]) {
  const byId = new Map(contexts.map(c => [c.id, c])), children = new Map<string, string[]>(), incoming = new Map<string, number>()
  for (const c of contexts) {
    incoming.set(c.id, c.parentIds.filter(id => byId.has(id)).length)
    for (const id of c.parentIds) { const rows = children.get(id) ?? []; rows.push(c.id); children.set(id, rows) }
  }
  const ordered = contexts.filter(c => incoming.get(c.id) === 0).map(c => c.id)
  for (let i = 0; i < ordered.length; i++) for (const id of children.get(ordered[i]) ?? []) {
    const count = incoming.get(id)! - 1; incoming.set(id, count); if (count === 0) ordered.push(id)
  }
  const ranks = new Map(ordered.map((id, i) => [id, i])), cache = new Map<string, boolean>()
  const before = (a: string, b: string): boolean => {
    if (a === b || !byId.has(a) || !byId.has(b) || ranks.get(a)! >= ranks.get(b)!) return false
    const key = JSON.stringify([a, b]), cached = cache.get(key); if (cached !== undefined) return cached
    const pending = [...byId.get(b)!.parentIds], seen = new Set<string>(); let result = false
    for (let i = 0; i < pending.length; i++) {
      const id = pending[i]; if (id === a) { result = true; break }
      if (seen.has(id)) continue; seen.add(id); pending.push(...(byId.get(id)?.parentIds ?? []))
    }
    if (cache.size >= 4096) cache.clear(); cache.set(key, result); return result
  }
  return { byId, before, ranks }
}

/** All indicators are recomputed from durable immutable facts. No network, timer or persisted mastery flag. */
export function deriveLearning(input: LearningInput): LearningSnapshot {
  const now = Date.parse(input.now), policy = input.policy
  if (!Number.isFinite(now) || !policy.version || !policy.intervalDays.length || !policy.intervalDays.every((v, i, a) => Number.isInteger(v) && v > 0 && (!i || v > a[i - 1]))
    || ![policy.requiredCorrect, policy.requiredDays, policy.requiredFamilies].every(v => Number.isInteger(v) && v > 0)
    || !Number.isFinite(policy.clockToleranceMs) || policy.clockToleranceMs < 0) throw new Error('Política o fecha de evaluación inválida.')
  const events = mergeEvents(input.accountId, input.events.filter(e => e.accountId === input.accountId))
  const all = new Map(events.map(e => [e.id, e])), contexts = events.filter((e): e is LearningContext => e.kind === 'learning-context')
  const incomplete = new Set(validateLearningHistory(events).incompleteContextIds), graph = causalGraph(contexts)
  const packs = new Map<string, LabPackage>()
  for (const pack of input.packages) {
    const key = packKey({ packageId: pack.id, packageVersion: pack.version }), prior = packs.get(key)
    if (prior && canonical(prior) !== canonical(pack)) throw new Error('Dos contenidos distintos usan la misma edición de paquete.')
    packs.set(key, pack)
  }
  const activityFor = (ref: ActivityRef) => packs.get(packKey(ref))?.activities.find(a => a.id === ref.activityId && a.version === ref.activityVersion)
  const family = equivalence(input.equivalences?.families), scenario = equivalence(input.equivalences?.scenarios), original = equivalence(input.equivalences?.originals)
  const related = (a: Activity, b: Activity) => family(a.familyId) === family(b.familyId) || scenario(a.scenarioId) === scenario(b.scenarioId)
    || !!a.provenance.originalId && !!b.provenance.originalId && original(a.provenance.originalId) === original(b.provenance.originalId)
  const origin = (a: Attempt) => {
    const fact = a.ipv4 ? all.get(a.ipv4.predictionId) : a
    const id = fact && 'learningContextId' in fact ? fact.learningContextId : undefined
    return id ? graph.byId.get(id) : undefined
  }
  const timeIssues = new Map<string, LearningReason[]>()
  for (const c of contexts) {
    const issues: LearningReason[] = [], stamp = Date.parse(c.createdAt)
    if (stamp > now + policy.clockToleranceMs) issues.push(reason('future-clock', 'La fecha capturada está por delante del reloj actual.', c.id))
    for (const id of c.parentIds) {
      const p = graph.byId.get(id); if (!p) continue
      const delta = stamp - Date.parse(p.createdAt)
      if (delta < -policy.clockToleranceMs) issues.push(reason('clock-regressed', 'La fecha retrocede respecto a una acción causal previa.', p.id, c.id))
      if (p.deviceId === c.deviceId && p.clock.clockSessionId === c.clock.clockSessionId
        && (c.clock.monotonicMs < p.clock.monotonicMs || Math.abs(delta - (c.clock.monotonicMs - p.clock.monotonicMs)) > policy.clockToleranceMs)) {
        issues.push(reason('clock-discontinuity', 'El reloj de pared y el monotónico de esta sesión no concuerdan.', p.id, c.id))
      }
    }
    timeIssues.set(c.id, issues)
  }
  const suspectSessions = new Map<string, LearningContext[]>()
  const clockKey = (c: LearningContext) => JSON.stringify([c.deviceId, c.clock.clockSessionId])
  for (const c of contexts) if (timeIssues.get(c.id)?.length) {
    const key = clockKey(c), values = suspectSessions.get(key) ?? []
    values.push(c); suspectSessions.set(key, values)
  }
  for (const c of contexts) {
    const earlier = suspectSessions.get(clockKey(c))?.filter(prior => graph.before(prior.id, c.id)) ?? []
    if (earlier.length) timeIssues.get(c.id)!.push(reason('clock-session-uncertain',
      'Una acción anterior de esta sesión de reloj tiene una fecha incoherente.', ...earlier.map(prior => prior.id), c.id))
  }
  const attempts = events.filter((e): e is Attempt => e.kind === 'attempt')
  const rows = new Map<string, LearningAttemptEvidence>()
  for (const a of attempts) {
    const c = origin(a), activity = activityFor(a), pack = packs.get(packKey(a))
    const row: LearningAttemptEvidence = { attemptId: a.id, ref: refOf(a), objectiveIds: [...a.objectiveIds], familyId: a.familyId,
      contextId: c?.id ?? null, eligibility: 'eligible', first: false, unaided: false, referenceSupport: 'uncertain', freshness: 'not-applicable', understanding: false, understandingObjectiveIds: [],
      retention: false, retentionObjectiveIds: [], transfer: false, day: c?.clock.day ?? null,
      timeStatus: c ? timeIssues.get(c.id)?.length ? 'uncertain' : 'declared-device' : 'historical', reasons: [] }
    rows.set(a.id, row)
    const grading = activity?.kind === 'choice' ? 'choice-v1'
      : activity?.kind === 'code' ? 'stdout-datasets-v1' : activity?.kind === 'html-css' ? 'html-dom-css-v1' : activity?.mode.version
    if (!activity || !pack || activity.state !== 'validated' || activity.provenance.status !== 'eligible'
      || a.objectiveIds.some(id => !pack.objectives.some(o => o.id === id && o.state === 'validated'))
      || canonical([...activity.objectiveIds].sort()) !== canonical([...a.objectiveIds].sort())
      || activity.familyId !== a.familyId || activity.phase !== a.phase
      || (activity.kind === 'sql' ? !supportsSqlGrading(a.gradingVersion) : grading !== a.gradingVersion)) {
      row.eligibility = 'excluded'; row.reasons.push(reason('content-ineligible', 'Falta la edición validada/elegible o no concuerda con el intento.', a.id)); continue
    }
    const declaredDiagnostics = a.diagnosticIds ?? []
    if (declaredDiagnostics.some(id => !activity.learning?.diagnostics.some(d => d.id === id))
      || activity.kind === 'choice' && declaredDiagnostics.length > 0 && canonical([...declaredDiagnostics].sort()) !== canonical(preparedDiagnosticIds(activity, a.answer))) {
      row.eligibility = 'excluded'; row.reasons.push(reason('diagnostic-inconsistent', 'El diagnóstico no coincide con una regla preparada de esta edición.', a.id)); continue
    }
    if (!c) {
      const prediction = a.ipv4 ? all.get(a.ipv4.predictionId) : undefined
      const pending = !!a.learningContextId || !!a.ipv4 && (!prediction || 'learningContextId' in prediction && !!prediction.learningContextId)
      row.eligibility = pending ? 'uncertain' : 'historical'; row.timeStatus = pending ? 'uncertain' : 'historical'
      row.reasons.push(reason(pending ? 'pending-causality' : 'legacy-context', pending
        ? 'Falta el contexto prospectivo o la predicción referenciada.' : 'Intento histórico sin captura causal prospectiva.', a.id)); continue
    }
    if (incomplete.has(c.id)) { row.eligibility = 'uncertain'; row.reasons.push(reason('pending-causality', 'Faltan hechos o padres del contexto.', c.id)); continue }
    const otherAnswers = contexts.filter(v => v.action === 'answer' && v.id !== c.id && v.presentationId === c.presentationId)
    if (otherAnswers.some(v => graph.before(v.id, c.id))) row.reasons.push(reason('retry', 'Respuesta posterior dentro de la misma presentación.', a.id))
    else if (otherAnswers.some(v => !graph.before(c.id, v.id))) {
      row.eligibility = 'uncertain'; row.reasons.push(reason('concurrent-first', 'Hay primeras respuestas concurrentes; no se elige una por fecha.', c.id))
    } else row.first = true
    const helps = contexts.filter(v => v.action === 'help' && v.presentationId === c.presentationId && v.factIds.some(id => {
      const e = all.get(id); return e?.kind === 'assistance' && (e.hintCount > 0 || e.solutionViewed)
    }))
    const unplacedAid = events.some(e => (e.kind === 'assistance' || e.kind === 'attempt') && e.id !== a.id
      && e.attemptGroupId === a.attemptGroupId && refKey(e) === refKey(a) && (e.hintCount > 0 || e.solutionViewed)
      && (!e.learningContextId || !graph.byId.has(e.learningContextId)))
    const presentation = c.presentationId ? graph.byId.get(c.presentationId) : undefined
    let reference = presentation?.contractVersion === 2 && presentation.referenceVisible === true
    let referenceUncertain = c.contractVersion !== 2 || presentation?.contractVersion !== 2
    const referenceIds: string[] = reference && presentation ? [presentation.id] : []
    for (const contact of contexts) {
      if (contact.action === 'reference' && contact.presentationId === c.presentationId) {
        if (graph.before(c.id, contact.id)) continue
        referenceIds.push(contact.id)
        if (!incomplete.has(contact.id) && graph.before(contact.id, c.id)) reference = true
        else referenceUncertain = true
      } else if (contact.action === 'reading' && contact.target.kind === 'lesson'
        && contact.target.packageId === a.packageId && contact.target.packageVersion === a.packageVersion) {
        const target = contact.target
        const lesson = pack.lessons.find(l => l.id === target.lessonId && l.version === target.lessonVersion)
        if (lesson && !lesson.objectiveIds.some(id => a.objectiveIds.includes(id))) continue
        // Prior study and later feedback are not support for this answer. Clocks never order concurrent branches.
        if (graph.before(c.id, contact.id) || presentation && graph.before(contact.id, presentation.id)) continue
        referenceIds.push(contact.id)
        if (lesson && !incomplete.has(contact.id) && presentation && graph.before(presentation.id, contact.id)
          && graph.before(contact.id, c.id)) reference = true
        else referenceUncertain = true
      }
    }
    row.referenceSupport = reference ? 'recorded' : referenceUncertain ? 'uncertain' : 'none'
    if (reference) row.reasons.push(reason('reference-support', 'Hubo texto de apoyo disponible o consultado antes de responder; no implica ver la solución.', ...referenceIds))
    else if (referenceUncertain) {
      row.eligibility = 'uncertain'
      row.reasons.push(reason(c.contractVersion !== 2 || presentation?.contractVersion !== 2 ? 'legacy-reference-unknown' : 'reference-order-unknown',
        'La captura o el orden causal no permite afirmar ausencia de apoyo textual.', c.id, ...referenceIds))
    }
    if (a.hintCount || a.solutionViewed || helps.some(v => graph.before(v.id, c.id))) row.reasons.push(reason('helped', 'La respuesta tuvo pistas o solución previa.', a.id))
    else if (unplacedAid || helps.some(v => !graph.before(c.id, v.id))) {
      row.eligibility = 'uncertain'; row.reasons.push(reason('help-order-unknown', 'No se puede ordenar una ayuda concurrente o histórica del mismo grupo.', c.id))
    }
    else row.unaided = row.referenceSupport === 'none'
    const needsFresh = activity.phase === 'reserved' || activity.phase === 'delayed' && activity.evaluationIntent !== 'retention'
    if (needsFresh) {
      let exposed = false, uncertain = false
      for (const e of events) {
        if (e.id === a.id || e.kind !== 'exposure' && e.kind !== 'attempt') continue
        let matches = family(e.familyId) === family(activity.familyId), otherContext: LearningContext | undefined
        if (e.kind === 'attempt') { const otherActivity = activityFor(e); matches ||= !!otherActivity && related(activity, otherActivity); otherContext = origin(e) }
        else {
          otherContext = e.learningContextId ? graph.byId.get(e.learningContextId) : undefined
          if (otherContext?.target.kind === 'activity') { const otherActivity = activityFor(otherContext.target); matches ||= !!otherActivity && related(activity, otherActivity) }
          if (otherContext?.id === c.presentationId && otherContext.action === 'present' && otherContext.factIds.includes(e.id)) continue
        }
        if (!matches) continue
        if (!otherContext || incomplete.has(otherContext.id)) uncertain = true
        else if (graph.before(otherContext.id, c.id)) exposed = true
        else if (!graph.before(c.id, otherContext.id)) uncertain = true
      }
      row.freshness = exposed ? 'exposed' : uncertain ? 'uncertain' : 'fresh'
      if (row.freshness !== 'fresh') row.reasons.push(reason(row.freshness === 'exposed' ? 'family-exposed' : 'freshness-unknown',
        row.freshness === 'exposed' ? 'La familia, escenario u original ya se presentó.' : 'La novedad no puede establecerse con el historial disponible.', a.id))
    }
    row.understanding = row.eligibility === 'eligible' && row.first && row.unaided && a.outcome === 'correct'
    row.transfer = row.understanding && row.freshness === 'fresh'
    row.reasons.push(...(timeIssues.get(c.id) ?? []))
  }
  const contactObjectives = (c: LearningContext): string[] => {
    const target = c.target, pack = packs.get(packKey(target)); if (!pack) return []
    return target.kind === 'activity' ? activityFor(target)?.objectiveIds ?? []
      : pack.lessons.find(l => l.id === target.lessonId && l.version === target.lessonVersion)?.objectiveIds ?? []
  }
  const objectives: ObjectiveLearning[] = []
  for (const pack of [...packs.values()].sort((a, b) => packKey({ packageId: a.id, packageVersion: a.version }).localeCompare(packKey({ packageId: b.id, packageVersion: b.version })))) {
    for (const objective of pack.objectives) {
      const scoped = attempts.filter(a => a.packageId === pack.id && a.packageVersion === pack.version && a.objectiveIds.includes(objective.id))
        .sort((a, b) => (graph.ranks.get(origin(a)?.id ?? '') ?? -1) - (graph.ranks.get(origin(b)?.id ?? '') ?? -1) || a.id.localeCompare(b.id))
      const contacts = contexts.filter(c => c.target.packageId === pack.id && c.target.packageVersion === pack.version && contactObjectives(c).includes(objective.id))
      // A later coherent contact bounds older contacts, including their uncertain clocks.
      // Incomparable branches remain separate; a timestamp never supplies causal order.
      const latestContacts = (values: LearningContext[]) => values.filter(c => !values.some(other => graph.before(c.id, other.id)))
      const qualifying: Attempt[] = [], understood: string[] = [], dedup = new Set<string>(), lastItemCredit = new Map<string, number>()
      let step = 0, lastAdvance: string | null = null
      for (const a of scoped) {
        const row = rows.get(a.id)!, c = origin(a)
        if (!c || row.eligibility !== 'eligible') continue
        if (a.outcome === 'incorrect' || a.outcome === 'correct' && !row.unaided) step = 0
        if (!row.understanding) continue
        const activity = activityFor(a)!, item = activity.provenance.originalId ? `original:${original(activity.provenance.originalId)}` : `activity:${a.activityId}`
        const key = JSON.stringify([item, c.clock.day])
        if (dedup.has(key) || lastItemCredit.has(item) && Date.parse(c.createdAt) - lastItemCredit.get(item)! < DAY) {
          row.reasons.push(reason('same-item-day', 'Repetir el mismo ejercicio sin otro día y 24 horas no añade evidencia independiente para este objetivo.', a.id)); continue
        }
        dedup.add(key); understood.push(a.id); row.understandingObjectiveIds.push(objective.id)
        if (row.timeStatus !== 'declared-device') continue
        lastItemCredit.set(item, Date.parse(c.createdAt)); qualifying.push(a)
        if (activity.phase === 'delayed') {
          const prior = contacts.filter(v => v.id !== c.id && v.id !== c.presentationId && graph.before(v.id, c.id))
          const ambiguous = contacts.some(v => v.id !== c.id && v.id !== c.presentationId && !graph.before(v.id, c.id) && !graph.before(c.id, v.id))
          const latest = latestContacts(prior)
          const usable = latest.filter(v => !incomplete.has(v.id) && !timeIssues.get(v.id)?.length)
          const lastContact = usable.length ? Math.max(...usable.map(v => Date.parse(v.createdAt))) : NaN
          if (!ambiguous && usable.length === latest.length && Number.isFinite(lastContact)
            && Date.parse(c.createdAt) - lastContact >= policy.intervalDays[step] * DAY) {
            row.retention = true; row.retentionObjectiveIds.push(objective.id)
            if (!lastAdvance || graph.before(lastAdvance, c.id)) { step = Math.min(step + 1, policy.intervalDays.length - 1); lastAdvance = c.id }
          } else row.reasons.push(reason('delay-not-established', 'No consta el intervalo previsto sin otro contacto registrado.', a.id))
        }
      }
      const reviews: LearningReview[] = []
      for (const a of scoped) {
        const row = rows.get(a.id)!, c = origin(a)
        if (!c || a.outcome !== 'incorrect' || row.eligibility === 'excluded' || row.eligibility === 'historical') continue
        const activity = activityFor(a)!, diagnoses = (a.diagnosticIds ?? []).map(id => activity.learning?.diagnostics.find(d => d.id === id))
          .filter(d => d?.objectiveIds.includes(objective.id))
        for (const diagnostic of diagnoses.length ? diagnoses : [undefined]) {
          const eligibleRecovery = qualifying.filter(r => {
            const rc = origin(r)!, ra = activityFor(r)!
            return graph.before(c.id, rc.id) && family(r.familyId) !== family(a.familyId)
              && (diagnostic?.severity !== 'critical' || ra.learning?.rechecksDiagnosticIds.includes(diagnostic.id))
          })
          let recoveredBy: string[] = []
          for (const first of eligibleRecovery) {
            const second = eligibleRecovery.find(r => r.id !== first.id && rows.get(r.id)!.retentionObjectiveIds.includes(objective.id)
              && graph.before(origin(first)!.id, origin(r)!.id)
              && !scoped.some(error => error.outcome === 'incorrect' && origin(error) && error.id !== a.id
                && graph.before(origin(first)!.id, origin(error)!.id) && graph.before(origin(error)!.id, origin(r)!.id)))
            if (second) { recoveredBy = [first.id, second.id]; break }
          }
          reviews.push({ attemptId: a.id, diagnosticId: diagnostic?.id ?? null, severity: diagnostic?.severity ?? 'ordinary', recoveredBy, open: !recoveredBy.length })
        }
      }
      const open = reviews.filter(r => r.open)
      if (open.length) step = 0
      const latest = latestContacts(contacts)
      const declaredContacts = latest.filter(c => !incomplete.has(c.id) && !timeIssues.get(c.id)?.length)
      const lastContact = declaredContacts.length ? Math.max(...declaredContacts.map(c => Date.parse(c.createdAt))) : NaN
      const latestAttempts = scoped.filter(a => origin(a) && rows.get(a.id)!.eligibility === 'eligible'
        && !scoped.some(b => origin(b) && graph.before(origin(a)!.id, origin(b)!.id)))
      const nextDelayDays = latestAttempts.some(a => a.outcome === 'omitted') ? 1 : policy.intervalDays[step]
      const schedule = (qualifying.length || open.length) && Number.isFinite(lastContact)
        ? { intervalDays: policy.intervalDays[step], nextDelayDays, dueAt: new Date(lastContact + nextDelayDays * DAY).toISOString(),
          overdue: lastContact + nextDelayDays * DAY <= now,
          timeStatus: latest.some(c => timeIssues.get(c.id)?.length || incomplete.has(c.id)) ? 'uncertain' as const : 'declared-device' as const } : null
      const orderedTimes = qualifying.map(a => origin(a)!).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
      const dayWitnesses: LearningContext[] = []
      for (const c of orderedTimes) if (!dayWitnesses.length || c.clock.day !== dayWitnesses[dayWitnesses.length - 1].clock.day
        && Date.parse(c.createdAt) - Date.parse(dayWitnesses[dayWitnesses.length - 1].createdAt) >= DAY) dayWitnesses.push(c)
      const understandingIds = understood
      const retentionIds = scoped.filter(a => rows.get(a.id)!.retentionObjectiveIds.includes(objective.id)).map(a => a.id)
      const transferIds = scoped.filter(a => understood.includes(a.id) && rows.get(a.id)!.transfer).map(a => a.id)
      const uncertain = scoped.some(a => rows.get(a.id)!.eligibility === 'uncertain'
        && (!origin(a) || qualifying.filter(q => graph.before(origin(a)!.id, origin(q)!.id)).length < policy.requiredCorrect))
      const requirements: LearningRequirements = { correct: { actual: qualifying.length, required: policy.requiredCorrect },
        families: { actual: new Set(qualifying.map(a => family(a.familyId))).size, required: policy.requiredFamilies },
        days: { actual: dayWitnesses.length, required: policy.requiredDays }, delayed: retentionIds.length > 0,
        freshTransfer: transferIds.length > 0, noOpenErrors: !open.length, noRelevantUncertainty: !uncertain }
      const satisfied = requirements.correct.actual >= requirements.correct.required && requirements.families.actual >= requirements.families.required
        && requirements.days.actual >= requirements.days.required && requirements.delayed && requirements.freshTransfer
        && requirements.noOpenErrors && requirements.noRelevantUncertainty
      const reasons: LearningReason[] = []
      if (open.length) reasons.push(reason('error-review-open', 'Hay errores observados pendientes de recuperación y comprobación diferida.', ...open.map(r => r.attemptId)))
      if (!requirements.delayed) reasons.push(reason('needs-retention', 'Falta una comprobación diferida con intervalo establecido.'))
      if (!requirements.freshTransfer) reasons.push(reason('needs-transfer', 'Falta una primera resolución de familia nueva sin ayuda.'))
      if (requirements.correct.actual < policy.requiredCorrect) reasons.push(reason('needs-correct', `Constan ${requirements.correct.actual} de ${policy.requiredCorrect} aciertos elegibles.`))
      if (requirements.families.actual < policy.requiredFamilies) reasons.push(reason('needs-families', 'Faltan familias diferentes.'))
      if (requirements.days.actual < policy.requiredDays) reasons.push(reason('needs-days', 'Faltan días capturados distintos separados por al menos 24 horas.'))
      if (uncertain) reasons.push(reason('uncertain-evidence', 'Hay respuestas con evidencia causal indeterminada.'))
      objectives.push({ key: learningObjectiveKey(pack.id, pack.version, objective.id), packageId: pack.id, packageVersion: pack.version,
        objectiveId: objective.id, topicId: objective.topicId, title: objective.statement,
        status: open.length ? 'review-open' : satisfied ? 'consolidated' : uncertain ? 'uncertain' : 'insufficient',
        understandingIds, retentionIds, transferIds, qualifyingCorrectIds: qualifying.map(a => a.id), requirements, reviews, schedule, reasons })
    }
  }
  const evidence = [...rows.values()]
  for (const row of evidence) { row.understanding = row.understandingObjectiveIds.length > 0; row.transfer &&= row.understanding }
  const contacts: LearningContact[] = contexts.map(c => {
    const target = c.target, pack = packs.get(packKey(target)), ids = contactObjectives(c)
    const eligible = ids.length > 0 && ids.every(id => pack?.objectives.some(o => o.id === id && o.state === 'validated'))
      && (target.kind === 'activity' ? activityFor(target)?.state === 'validated' && activityFor(target)?.provenance.status === 'eligible'
        : pack?.lessons.some(l => l.id === target.lessonId && l.version === target.lessonVersion && l.state === 'validated'))
    const reasons = [...(timeIssues.get(c.id) ?? [])]
    if (!eligible) reasons.push(reason('contact-content-ineligible', 'El contacto no resuelve contenido elegible de esa edición.', c.id))
    if (incomplete.has(c.id)) reasons.push(reason('pending-causality', 'El contacto tiene referencias pendientes.', c.id))
    return { contextId: c.id, packageId: target.packageId, packageVersion: target.packageVersion, objectiveIds: ids,
      createdAt: c.createdAt, day: c.clock.day, studySessionId: c.studySessionId, usableTime: !!eligible && !reasons.length, reasons }
  })
  return { accountId: input.accountId, policyVersion: policy.version, evaluatedAt: input.now, objectives, attempts: evidence,
    dueReviews: objectives.filter(o => o.schedule?.overdue || o.reviews.some(r => r.open)), contacts,
    uncertainties: evidence.flatMap(e => e.reasons.filter(r => ['pending-causality', 'concurrent-first', 'help-order-unknown', 'freshness-unknown',
      'future-clock', 'clock-regressed', 'clock-discontinuity', 'clock-session-uncertain'].includes(r.code))), timeBasis: 'declared-device' }
}
