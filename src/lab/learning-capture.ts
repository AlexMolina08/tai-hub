import type { Activity, EventBase, LabEvent, LearningContext, LearningTarget } from './model'
import { captureLearningClock, learningPresentation, planLearningContext } from './learning-context'

type ActivityTarget = Extract<LearningTarget, { kind: 'activity' }>
type Recorder = (events: LabEvent[]) => Promise<void>
export interface LearningCaptureOptions { referenceVisible?: boolean }
const sessions = new Map<string, { study: string; clock: string }>()
function session(accountId: string, deviceId: string) {
  const key = JSON.stringify([accountId, deviceId])
  let value = sessions.get(key)
  if (!value) {
    value = { study: crypto.randomUUID(), clock: crypto.randomUUID() }
    sessions.set(key, value)
  }
  return value
}

/** Browser-only capture. The learning policy itself has no clock, storage or network access.
 * A capture instance survives renders; stable presentation batches can be retried atomically.
 * Confirmed facts bridge the small interval between local persistence and the next React render.
 */
export class LearningCapture {
  private readonly confirmed = new Map<string, LabEvent>()
  private readonly presentations = new Map<string, { id: string | null; events: LabEvent[] }>()
  private readonly references = new Map<string, LabEvent[]>()
  private readonly session: { study: string; clock: string }
  warning = ''

  constructor(private accountId: string, private deviceId: string, private history: () => LabEvent[]) {
    this.session = session(accountId, deviceId)
  }

  private known() {
    const all = new Map(this.history().map(event => [event.id, event]))
    for (const [id, event] of this.confirmed) {
      if (all.has(id)) this.confirmed.delete(id)
      else all.set(id, event)
    }
    return [...all.values()]
  }

  confirm(events: LabEvent[]) {
    for (const event of events) this.confirmed.set(event.id, event)
  }

  private plan(action: LearningContext['action'], target: LearningTarget, presentationId: string | null,
    facts: LabEvent[], history: LabEvent[], base?: EventBase, options: LearningCaptureOptions = {}) {
    const at = base?.createdAt ?? facts.find(event => action === 'answer'
      ? event.kind === 'attempt' || event.kind === 'ipv4-prediction'
      : action === 'help' ? event.kind === 'assistance' : action === 'present' ? event.kind === 'exposure'
        : event.kind === 'ipv4-reset')?.createdAt
    if (!at) throw new Error('Falta el hecho original para guardar el contexto de estudio.')
    const result = planLearningContext({ id: crypto.randomUUID(), action, target, presentationId,
      studySessionId: this.session.study, clock: captureLearningClock(at, this.session.clock, performance.now()),
      facts, history, ...(base ? { base } : {}), ...(action === 'present' ? { referenceVisible: options.referenceVisible ?? false } : {}) })
    if (result.status === 'historical') this.warning = result.reason
    return result
  }

  /** A restored, unanswered presentation stays the same across reloads and devices. */
  present(target: ActivityTarget, activity: Activity, predictionId?: string | null, options: LearningCaptureOptions = {}) {
    const known = this.known(), key = JSON.stringify(target)
    const finish = (value: { id: string | null; events: LabEvent[] }) => options.referenceVisible || value.id && this.references.has(value.id)
      ? this.withReference(value, target) : value
    if (predictionId) {
      const prediction = known.find(event => event.id === predictionId && event.kind === 'ipv4-prediction')
      const answer = prediction && 'learningContextId' in prediction
        ? known.find(event => event.id === prediction.learningContextId && event.kind === 'learning-context') as LearningContext | undefined : undefined
      if (answer?.presentationId) return finish({ id: answer.presentationId, events: [] as LabEvent[] })
      // An old prediction cannot acquire a new first-answer context by being revealed now.
      return { id: null, events: [] as LabEvent[] }
    }
    const saved = this.presentations.get(key)
    if (saved) return finish(saved)
    const pending = learningPresentation(known, this.accountId, target)
    if (pending.status === 'pending' && pending.presentation) {
      const value = { id: pending.presentation.id, events: [] as LabEvent[] }
      this.presentations.set(key, value)
      return finish(value)
    }
    const exposure: LabEvent = { kind: 'exposure', id: crypto.randomUUID(), accountId: this.accountId,
      deviceId: this.deviceId, createdAt: new Date().toISOString(), familyId: activity.familyId, reason: 'presented' }
    const result = this.plan('present', target, null, [exposure], known, undefined, options)
    const value = { id: result.context?.id ?? null, events: result.events }
    this.presentations.set(key, value)
    return finish(value)
  }

  private withReference(presentation: { id: string | null; events: LabEvent[] }, target: ActivityTarget) {
    if (!presentation.id) return presentation
    const known = this.known(), initial = presentation.events.filter(event => !known.some(saved => saved.id === event.id))
    const history = [...known, ...initial], p = history.find(event => event.id === presentation.id)
    if (p?.kind === 'learning-context' && p.contractVersion === 2 && p.referenceVisible
      || history.some(event => event.kind === 'learning-context' && event.action === 'reference' && event.presentationId === presentation.id)) return presentation
    let batch = this.references.get(presentation.id)
    if (!batch) {
      const base = { id: crypto.randomUUID(), accountId: this.accountId, deviceId: this.deviceId, createdAt: new Date().toISOString() }
      batch = this.plan('reference', target, presentation.id, [], history, base).events
      this.references.set(presentation.id, batch)
    }
    return { id: presentation.id, events: [...initial, ...batch.filter(event => !known.some(saved => saved.id === event.id))] }
  }

  /** One stable semantic batch when reference text appears after presentation, e.g. resize.
   * The caller retains/replays it through the semantic buffer; it never discloses a solution.
   */
  reference(target: ActivityTarget, activity: Activity, predictionId?: string | null): LabEvent[] {
    const events = this.present(target, activity, predictionId, { referenceVisible: true }).events
    const known = new Set(this.known().map(event => event.id))
    return events.filter(event => !known.has(event.id))
  }

  /** Decorate new semantic facts only. Draft text and old IPv4 attempts remain unchanged. */
  prepare(target: ActivityTarget, activity: Activity, facts: LabEvent[], predictionId?: string | null, options: LearningCaptureOptions = {}) {
    const presentation = this.present(target, activity, predictionId, options)
    const known = this.known()
    const initial = presentation.events.filter(event => !known.some(saved => saved.id === event.id))
    const action = facts.some(event => event.kind === 'ipv4-prediction' || event.kind === 'attempt' && !event.ipv4) ? 'answer'
      : facts.some(event => event.kind === 'assistance') ? 'help'
        : facts.some(event => event.kind === 'ipv4-reset') ? 'reset' : null
    if (!action || !presentation.id) return [...initial, ...facts]
    const linked = facts.filter(event => action === 'answer' ? event.kind === 'ipv4-prediction' || event.kind === 'attempt' && !event.ipv4
      : action === 'help' ? event.kind === 'assistance' || event.kind === 'exposure' : event.kind === 'ipv4-reset')
    const rest = facts.filter(event => !linked.includes(event))
    const result = this.plan(action, target, presentation.id, linked, [...known, ...initial])
    return [...initial, ...rest, ...result.events]
  }

  reading(target: Extract<LearningTarget, { kind: 'lesson' }>) {
    const base = { id: crypto.randomUUID(), accountId: this.accountId, deviceId: this.deviceId, createdAt: new Date().toISOString() }
    return this.plan('reading', target, null, [], this.known(), base).events
  }

  async write(events: LabEvent[], record: Recorder) {
    await record(events)
    this.confirm(events)
  }
}
