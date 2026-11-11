/** Persistence adapter for the fixed numeric model. No I/O, clocks or ID generation. */
import { MODEL_VERSION, createState, submitPrediction, reveal, validateInput,
  type IPv4Input, type IPv4Prediction, type IPv4Comparison, type IPv4Calculation } from './ipv4'
import type { ActivityRef, EventBase, IPv4ModelActivity, IPv4PredictionEvent, IPv4RevealEvent,
  IPv4ResetEvent, Attempt, LabEvent, Draft } from './model'

export const IPV4_ENGINE = 'tai-ipv4-block'
export const IPV4_DRAFT_FORMAT = 'ipv4-model-v1'
const ATTEMPT_FEEDBACK = 'Comparación numérica por campos. La nota conceptual no se califica.'
/** Injective logical identity: concurrent reveals of one prediction share one original attempt. */
export const ipv4AttemptId = (predictionId: string): string => `ipv4-attempt:${predictionId}`
export class IPv4WorkflowError extends Error {
  constructor(message: string) { super(message); this.name = 'IPv4WorkflowError' }
}
export interface IPv4WorkflowView {
  schema: 1
  modelVersion: string
  phase: 'editing' | 'predicted' | 'revealed'
  input: IPv4Input
  prediction: IPv4Prediction
  predictionId: string | null
  revealId: string | null
  resetId: string | null
}
export interface IPv4ActionContext {
  accountId: string
  deviceId: string
  createdAt: string
  packageId: string
  packageVersion: string
  attemptGroupId: string
  activeMs: number
}
export interface IPv4Plan { view: IPv4WorkflowView; events: LabEvent[] }
export interface IPv4WorkflowReading {
  status: 'editing' | 'pending' | 'predicted' | 'revealed'
  result: IPv4Calculation | null
  comparison: IPv4Comparison | null
  missingIds: string[]
}
const inputKeys = ['address', 'format', 'value', 'probe', 'context'] as const
const predictionKeys = ['omitted', 'lower', 'upper', 'member', 'interpretationNote']
const viewKeys = ['schema', 'modelVersion', 'phase', 'input', 'prediction', 'predictionId', 'revealId', 'resetId']
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const nonempty = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0
const integer = (x: unknown): x is number => Number.isSafeInteger(x) && Number(x) >= 0
const exactKeys = (x: Record<string, unknown>, keys: readonly string[]) => Object.keys(x).length === keys.length && keys.every(k => k in x)
const clone = <T>(x: T): T => structuredClone(x)
function ensure(value: unknown, message: string): asserts value { if (!value) throw new IPv4WorkflowError(message) }
// Separate from history.ts to keep this pure adapter free of a validation/import cycle.
const stable = (x: unknown): string => Array.isArray(x) ? `[${x.map(stable).join(',')}]`
  : record(x) ? `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${stable(x[k])}`).join(',')}}` : JSON.stringify(x)
const equal = (a: unknown, b: unknown) => stable(a) === stable(b)
const blankPrediction = (): IPv4Prediction => ({ omitted: false, lower: '', upper: '', member: 'omit', interpretationNote: '' })
function inputShape(value: unknown, valid: boolean): asserts value is IPv4Input {
  ensure(record(value) && exactKeys(value, inputKeys) && inputKeys.every(k => typeof value[k] === 'string' && value[k].length <= 128), 'Entrada IPv4 inválida o demasiado larga.')
  if (valid) { const checked = validateInput(value); ensure(checked.ok, checked.ok ? '' : checked.error.message) }
}
function predictionShape(value: unknown): asserts value is IPv4Prediction {
  ensure(record(value) && exactKeys(value, predictionKeys) && typeof value.omitted === 'boolean'
    && typeof value.lower === 'string' && value.lower.length <= 64 && typeof value.upper === 'string' && value.upper.length <= 64
    && ['yes', 'no', 'omit'].includes(String(value.member)) && typeof value.interpretationNote === 'string'
    && value.interpretationNote.length <= 500, 'Predicción IPv4 inválida o demasiado larga.')
}
function normalizePrediction(input: IPv4Input, prediction: IPv4Prediction): IPv4Prediction {
  predictionShape(prediction)
  const submitted = submitPrediction(createState(input), prediction)
  ensure(!submitted.error, submitted.error?.message ?? 'Predicción inválida.')
  // Preserve all entered fields, including a conceptual note or text explicitly omitted from grading.
  return { ...prediction, lower: prediction.lower.trim(), upper: prediction.upper.trim(), interpretationNote: prediction.interpretationNote.trim() }
}
function evaluate(input: IPv4Input, prediction: IPv4Prediction) {
  inputShape(input, true)
  const p = normalizePrediction(input, prediction)
  const state = reveal(submitPrediction(createState(input), p))
  ensure(!state.error && state.result && state.comparison, 'No se puede calcular esta predicción IPv4.')
  const comparison = state.comparison
  const fields = [comparison.lower, comparison.upper, comparison.member].filter(x => x !== 'not-asked')
  const outcome: Attempt['outcome'] = fields.includes('incorrect') ? 'incorrect' : !fields.includes('correct') ? 'omitted'
    : fields.includes('omitted') ? 'partial' : 'correct'
  return { result: state.result, comparison, outcome, answer: outcome === 'omitted' ? null : JSON.stringify(p) }
}
export function validateIPv4Activity(value: unknown): void {
  ensure(record(value) && value.kind === 'ipv4-model' && value.phase === 'practice' && value.evaluationIntent === undefined
    && record(value.mode) && value.mode.kind === 'simulation' && value.mode.engine === IPV4_ENGINE
    && value.mode.version === MODEL_VERSION, 'Modalidad IPv4: solo práctica con modelo y versión fijos.')
  inputShape(value.initialInput, true)
}
export function createIPv4View(activity: IPv4ModelActivity): IPv4WorkflowView {
  validateIPv4Activity(activity)
  return { schema: 1, modelVersion: MODEL_VERSION, phase: 'editing', input: clone(activity.initialInput),
    prediction: blankPrediction(), predictionId: null, revealId: null, resetId: null }
}
export function parseIPv4View(value: string): IPv4WorkflowView {
  ensure(typeof value === 'string' && value.length <= 4000, 'Vista IPv4 demasiado larga.')
  let raw: unknown
  try { raw = JSON.parse(value) } catch { throw new IPv4WorkflowError('Vista IPv4: JSON inválido.') }
  ensure(record(raw) && exactKeys(raw, viewKeys) && raw.schema === 1 && raw.modelVersion === MODEL_VERSION
    && ['editing', 'predicted', 'revealed'].includes(String(raw.phase)), 'Vista IPv4 incompatible.')
  inputShape(raw.input, raw.phase !== 'editing'); predictionShape(raw.prediction)
  for (const key of ['predictionId', 'revealId', 'resetId']) ensure(raw[key] === null || (nonempty(raw[key]) && raw[key].length <= 300), 'Referencia IPv4 inválida.')
  ensure(raw.phase === 'editing' ? raw.predictionId === null && raw.revealId === null
    : nonempty(raw.predictionId) && (raw.phase === 'predicted' ? raw.revealId === null : nonempty(raw.revealId)), 'Fase IPv4 sin referencias coherentes.')
  if (raw.phase !== 'editing') ensure(equal(raw.prediction, normalizePrediction(raw.input, raw.prediction)), 'Predicción IPv4 sin normalizar.')
  return clone(raw as unknown as IPv4WorkflowView)
}
export const serializeIPv4View = (view: IPv4WorkflowView): string => JSON.stringify(parseIPv4View(JSON.stringify(view)))
export function editIPv4View(view: IPv4WorkflowView, patch: { input?: Partial<IPv4Input>; prediction?: Partial<IPv4Prediction> }): IPv4WorkflowView {
  const next = { ...parseIPv4View(serializeIPv4View(view)), phase: 'editing' as const, predictionId: null, revealId: null,
    input: { ...view.input, ...clone(patch.input ?? {}) }, prediction: { ...(view.phase === 'editing' ? view.prediction : blankPrediction()), ...clone(patch.prediction ?? {}) } }
  return parseIPv4View(JSON.stringify(next))
}
function ref(activity: IPv4ModelActivity, c: IPv4ActionContext): ActivityRef {
  return { activityId: activity.id, activityVersion: activity.version, packageId: c.packageId, packageVersion: c.packageVersion }
}
function base(c: IPv4ActionContext, id: string): EventBase {
  ensure([id, c.accountId, c.deviceId, c.packageId, c.packageVersion, c.attemptGroupId].every(nonempty)
    && id.length <= 300 && /^\d{4}-\d\d-\d\dT/.test(c.createdAt) && Number.isFinite(Date.parse(c.createdAt)) && integer(c.activeMs), 'Contexto de acción IPv4 inválido.')
  return { id, accountId: c.accountId, deviceId: c.deviceId, createdAt: c.createdAt }
}
const sameRef = (a: ActivityRef, b: ActivityRef) => a.activityId === b.activityId && a.activityVersion === b.activityVersion
  && a.packageId === b.packageId && a.packageVersion === b.packageVersion
const scoped = (event: LabEvent, activity: IPv4ModelActivity, c: IPv4ActionContext) => event.accountId === c.accountId
  && 'activityVersion' in event && sameRef(event, ref(activity, c)) && 'attemptGroupId' in event && event.attemptGroupId === c.attemptGroupId
function indexEvents(events: readonly LabEvent[]) {
  const all = new Map<string, LabEvent>()
  for (const e of events) {
    const old = all.get(e.id)
    ensure(!old || equal(old, e), `Colisión de identidad IPv4: ${e.id}.`)
    all.set(e.id, e)
  }
  return all
}
/** Missing links remain unresolved, and are checked again when their payload arrives. */
export function validateIPv4History(events: readonly LabEvent[]): { missingIds: string[] } {
  const all = indexEvents(events), missing = new Set<string>()
  const link = (from: LabEvent, id: string, kind: LabEvent['kind']): LabEvent | undefined => {
    ensure(id !== from.id, 'Referencia IPv4 circular.')
    const target = all.get(id)
    if (!target) { missing.add(id); return undefined }
    ensure(target.kind === kind && target.accountId === from.accountId, 'Enlace IPv4 de otro tipo o cuenta.')
    if ('activityVersion' in from && 'activityVersion' in target) ensure(sameRef(from, target)
      && 'attemptGroupId' in from && 'attemptGroupId' in target && from.attemptGroupId === target.attemptGroupId, 'Enlace IPv4 de otro contenido, versión o grupo.')
    return target
  }
  for (const e of events) {
    validateIPv4Event(e)
    if (e.kind === 'attempt' && e.ipv4) {
      const p = link(e, e.ipv4.predictionId, 'ipv4-prediction') as IPv4PredictionEvent | undefined
      if (p) ensure(equal(e.ipv4.input, p.input) && equal(e.ipv4.prediction, p.prediction)
        && e.familyId === p.familyId && equal(e.objectiveIds, p.objectiveIds) && e.ordinal === p.ordinal
        && e.hintCount === p.hintCount && e.solutionViewed === p.solutionViewed && e.activeMs === p.activeMs
        && e.createdAt === p.createdAt && e.deviceId === p.deviceId, 'El intento IPv4 no conserva la predicción y ayuda originales.')
    } else if (e.kind === 'ipv4-reveal') {
      const p = link(e, e.predictionId, 'ipv4-prediction') as IPv4PredictionEvent | undefined
      const a = link(e, e.attemptId, 'attempt') as Attempt | undefined
      const help = link(e, e.assistanceId, 'assistance')
      const exposure = link(e, e.exposureId, 'exposure')
      if (p) ensure(p.familyId === e.familyId, 'Familia IPv4 distinta al revelar.')
      if (a) ensure(a.ipv4?.predictionId === e.predictionId && a.familyId === e.familyId, 'Revelación IPv4 sin su intento original.')
      if (help?.kind === 'assistance') ensure(help.solutionViewed && (!p || help.hintCount >= p.hintCount), 'Revelación IPv4 sin ayuda posterior.')
      if (exposure?.kind === 'exposure') ensure(exposure.familyId === e.familyId && exposure.reason === 'solution', 'Revelación IPv4 sin exposición de la misma familia.')
    } else if (e.kind === 'ipv4-reset') {
      if (e.predictionId) link(e, e.predictionId, 'ipv4-prediction')
      if (e.revealId) {
        const r = link(e, e.revealId, 'ipv4-reveal') as IPv4RevealEvent | undefined
        if (r) ensure(r.predictionId === e.predictionId, 'Reinicio IPv4 de otra predicción.')
      }
    } else if (e.kind === 'draft' && e.valueFormat === IPV4_DRAFT_FORMAT) {
      const view = parseIPv4View(e.value)
      if (view.predictionId) {
        const p = link(e, view.predictionId, 'ipv4-prediction') as IPv4PredictionEvent | undefined
        if (p) ensure(equal(p.input, view.input) && equal(p.prediction, view.prediction), 'Vista IPv4 distinta de la predicción persistida.')
      }
      if (view.revealId) {
        const r = link(e, view.revealId, 'ipv4-reveal') as IPv4RevealEvent | undefined
        if (r) ensure(r.predictionId === view.predictionId, 'Vista IPv4 de otra revelación.')
      }
      if (view.resetId) link(e, view.resetId, 'ipv4-reset')
    }
  }
  return { missingIds: [...missing].sort() }
}
/** Structural and numeric checks; cross-event links are checked by validateIPv4History. */
export function validateIPv4Event(value: unknown): void {
  if (!record(value)) return
  const e = value
  if (e.kind === 'draft' && e.valueFormat !== undefined) {
    ensure(e.valueFormat === IPV4_DRAFT_FORMAT && typeof e.value === 'string', 'Formato de borrador IPv4 inválido.')
    parseIPv4View(e.value)
  }
  if (e.kind === 'attempt' && e.ipv4 !== undefined) {
    const payload = e.ipv4
    ensure(record(payload) && exactKeys(payload, ['modelVersion', 'predictionId', 'input', 'prediction', 'comparison'])
      && payload.modelVersion === MODEL_VERSION && nonempty(payload.predictionId) && payload.predictionId.length <= 300, 'Intento IPv4 incompatible.')
    inputShape(payload.input, true); predictionShape(payload.prediction)
    ensure(equal(payload.prediction, normalizePrediction(payload.input, payload.prediction)), 'Predicción IPv4 sin normalizar.')
    const expected = evaluate(payload.input, payload.prediction)
    ensure(exactKeys(e, ['id', 'accountId', 'deviceId', 'createdAt', 'activityId', 'activityVersion', 'packageId', 'packageVersion',
      'kind', 'familyId', 'objectiveIds', 'attemptGroupId', 'ordinal', 'answer', 'outcome', 'hintCount', 'solutionViewed', 'activeMs',
      'phase', 'feedback', 'gradingVersion', 'ipv4']) && e.id === ipv4AttemptId(payload.predictionId)
      && equal(payload.comparison, expected.comparison) && e.outcome === expected.outcome && e.answer === expected.answer
      && e.phase === 'practice' && e.gradingVersion === MODEL_VERSION && e.feedback === ATTEMPT_FEEDBACK, 'Comparación o resultado IPv4 incoherentes.')
  }
  if (!['ipv4-prediction', 'ipv4-reveal', 'ipv4-reset'].includes(String(e.kind))) return
  ensure(nonempty(e.id) && e.id.length <= 300 && e.modelVersion === MODEL_VERSION
    && ['activityId', 'activityVersion', 'packageId', 'packageVersion', 'attemptGroupId'].every(k => nonempty(e[k])), 'Acción IPv4 incompatible.')
  if (e.kind === 'ipv4-prediction') {
    ensure(nonempty(e.familyId) && Array.isArray(e.objectiveIds) && e.objectiveIds.length > 0 && e.objectiveIds.every(nonempty)
      && new Set(e.objectiveIds).size === e.objectiveIds.length && integer(e.ordinal) && e.ordinal > 0
      && integer(e.hintCount) && typeof e.solutionViewed === 'boolean' && integer(e.activeMs), 'Predicción IPv4 incompleta.')
    inputShape(e.input, true); predictionShape(e.prediction)
    ensure(equal(e.prediction, normalizePrediction(e.input, e.prediction)), 'Predicción IPv4 sin normalizar.')
  } else if (e.kind === 'ipv4-reveal') {
    ensure(['familyId', 'predictionId', 'attemptId', 'assistanceId', 'exposureId'].every(k => nonempty(e[k]))
      && new Set([e.id, e.predictionId, e.attemptId, e.assistanceId, e.exposureId]).size === 5, 'Revelación IPv4 sin enlaces distintos.')
  } else {
    ensure((e.predictionId === null || nonempty(e.predictionId)) && (e.revealId === null || nonempty(e.revealId))
      && (e.revealId === null || e.predictionId !== null), 'Reinicio IPv4 sin referencias coherentes.')
    inputShape(e.initialInput, true)
  }
}
function requireAction(activity: IPv4ModelActivity, c: IPv4ActionContext, view: IPv4WorkflowView, events: readonly LabEvent[]) {
  validateIPv4Activity(activity); parseIPv4View(serializeIPv4View(view))
  return readIPv4Workflow(activity, c, view, events)
}
export function readIPv4Workflow(activity: IPv4ModelActivity, c: IPv4ActionContext, view: IPv4WorkflowView, persistedEvents: readonly LabEvent[]): IPv4WorkflowReading {
  validateIPv4Activity(activity); parseIPv4View(serializeIPv4View(view)); validateIPv4History(persistedEvents)
  const all = indexEvents(persistedEvents), missing = new Set<string>()
  // A received action is not proof that its ancestors/companions have arrived.
  const todo = [view.predictionId, view.revealId, view.resetId].filter((id): id is string => id !== null), seen = new Set<string>()
  for (let index = 0; index < todo.length; index += 1) {
    const id = todo[index]
    if (seen.has(id)) continue
    seen.add(id)
    const event = all.get(id)
    if (!event) { missing.add(id); continue }
    if (event.kind === 'ipv4-reveal') todo.push(event.predictionId, event.attemptId, event.assistanceId, event.exposureId)
    else if (event.kind === 'attempt' && event.ipv4) todo.push(event.ipv4.predictionId)
    else if (event.kind === 'ipv4-reset') {
      if (event.predictionId) todo.push(event.predictionId)
      if (event.revealId) todo.push(event.revealId)
    }
  }
  const get = (id: string, kind: LabEvent['kind']) => {
    const e = all.get(id)
    if (!e) { missing.add(id); return undefined }
    ensure(e.kind === kind && scoped(e, activity, c), 'Vista IPv4 enlazada a otra cuenta, contenido, versión o grupo.')
    return e
  }
  if (view.resetId) {
    const reset = get(view.resetId, 'ipv4-reset') as IPv4ResetEvent | undefined
    if (reset) ensure(equal(reset.initialInput, activity.initialInput), 'Reinicio IPv4 distinto del caso inicial.')
  }
  let p: IPv4PredictionEvent | undefined
  if (view.predictionId) {
    p = get(view.predictionId, 'ipv4-prediction') as IPv4PredictionEvent | undefined
    if (p) ensure(equal(p.input, view.input) && equal(p.prediction, view.prediction) && p.familyId === activity.familyId
      && equal(p.objectiveIds, activity.objectiveIds), 'Vista IPv4 distinta de su predicción.')
  }
  if (view.revealId) {
    const r = get(view.revealId, 'ipv4-reveal') as IPv4RevealEvent | undefined
    if (r) {
      ensure(r.predictionId === view.predictionId && r.familyId === activity.familyId, 'Vista IPv4 de otra revelación.')
      get(r.attemptId, 'attempt'); get(r.assistanceId, 'assistance')
      const exposure = all.get(r.exposureId)
      if (!exposure) missing.add(r.exposureId)
      else ensure(exposure.kind === 'exposure' && exposure.accountId === c.accountId && exposure.familyId === activity.familyId && exposure.reason === 'solution', 'Exposición IPv4 incompatible.')
    }
  }
  if (missing.size) return { status: 'pending', result: null, comparison: null, missingIds: [...missing].sort() }
  if (view.phase === 'revealed' && p) {
    const expected = evaluate(p.input, p.prediction)
    return { status: 'revealed', result: expected.result, comparison: expected.comparison, missingIds: [] }
  }
  return { status: view.phase, result: null, comparison: null, missingIds: [] }
}
function plan(view: IPv4WorkflowView, events: LabEvent[], existing: readonly LabEvent[]): IPv4Plan {
  serializeIPv4View(view); validateIPv4History([...existing, ...events])
  return { view: clone(view), events: clone(events) }
}
export function planIPv4Prediction(activity: IPv4ModelActivity, c: IPv4ActionContext, view: IPv4WorkflowView,
  persistedEvents: readonly LabEvent[], ids: { predictionId: string }): IPv4Plan {
  ensure(requireAction(activity, c, view, persistedEvents).status === 'editing', 'Edita el caso antes de predecir; espera el guardado pendiente.')
  inputShape(view.input, true)
  const prediction = normalizePrediction(view.input, view.prediction)
  const own = persistedEvents.filter(e => scoped(e, activity, c))
  const aids = own.filter(e => e.kind === 'assistance' || e.kind === 'attempt' || e.kind === 'ipv4-prediction')
  const event: IPv4PredictionEvent = { ...base(c, ids.predictionId), ...ref(activity, c), kind: 'ipv4-prediction', modelVersion: MODEL_VERSION,
    familyId: activity.familyId, objectiveIds: clone(activity.objectiveIds), attemptGroupId: c.attemptGroupId,
    ordinal: own.reduce((max, e) => e.kind === 'attempt' || e.kind === 'ipv4-prediction' ? Math.max(max, e.ordinal) : max, 0) + 1,
    input: clone(view.input), prediction, hintCount: aids.reduce((max, e) => Math.max(max, e.hintCount), 0),
    solutionViewed: aids.some(e => e.solutionViewed) || persistedEvents.some(e => e.kind === 'exposure' && e.accountId === c.accountId
      && e.familyId === activity.familyId && e.reason === 'solution'), activeMs: c.activeMs }
  return plan({ ...view, phase: 'predicted', prediction, predictionId: event.id, revealId: null }, [event], persistedEvents)
}
export function planIPv4Reveal(activity: IPv4ModelActivity, c: IPv4ActionContext, view: IPv4WorkflowView,
  persistedEvents: readonly LabEvent[], ids: { revealId: string; assistanceId: string; exposureId: string }): IPv4Plan {
  ensure(requireAction(activity, c, view, persistedEvents).status === 'predicted', 'Persiste primero la predicción; no hay revelación nueva disponible.')
  const p = persistedEvents.find(e => e.id === view.predictionId) as IPv4PredictionEvent
  const value = evaluate(p.input, p.prediction)
  const attempt: Attempt = { id: ipv4AttemptId(p.id), accountId: p.accountId, deviceId: p.deviceId, createdAt: p.createdAt,
    ...ref(activity, c), kind: 'attempt', familyId: p.familyId,
    objectiveIds: clone(p.objectiveIds), attemptGroupId: p.attemptGroupId, ordinal: p.ordinal,
    answer: value.answer, outcome: value.outcome, hintCount: p.hintCount, solutionViewed: p.solutionViewed, activeMs: p.activeMs,
    phase: 'practice', feedback: ATTEMPT_FEEDBACK, gradingVersion: MODEL_VERSION,
    ipv4: { modelVersion: MODEL_VERSION, predictionId: p.id, input: clone(p.input), prediction: clone(p.prediction), comparison: value.comparison } }
  const action: IPv4RevealEvent = { ...base(c, ids.revealId), ...ref(activity, c), kind: 'ipv4-reveal', modelVersion: MODEL_VERSION,
    familyId: p.familyId, attemptGroupId: p.attemptGroupId, predictionId: p.id, attemptId: attempt.id, assistanceId: ids.assistanceId, exposureId: ids.exposureId }
  const assistance = { ...base(c, ids.assistanceId), ...ref(activity, c), kind: 'assistance' as const,
    attemptGroupId: p.attemptGroupId, hintCount: p.hintCount, solutionViewed: true }
  const exposure = { ...base(c, ids.exposureId), kind: 'exposure' as const, familyId: p.familyId, reason: 'solution' as const }
  return plan({ ...view, phase: 'revealed', revealId: action.id }, [attempt, action, assistance, exposure], persistedEvents)
}
export function planIPv4Reset(activity: IPv4ModelActivity, c: IPv4ActionContext, view: IPv4WorkflowView,
  persistedEvents: readonly LabEvent[], ids: { resetId: string }): IPv4Plan {
  ensure(requireAction(activity, c, view, persistedEvents).status !== 'pending', 'Espera el guardado pendiente antes de reiniciar.')
  const action: IPv4ResetEvent = { ...base(c, ids.resetId), ...ref(activity, c), kind: 'ipv4-reset', modelVersion: MODEL_VERSION,
    attemptGroupId: c.attemptGroupId, predictionId: view.predictionId, revealId: view.revealId, initialInput: clone(activity.initialInput) }
  return plan({ ...createIPv4View(activity), resetId: action.id }, [action], persistedEvents)
}
/** Convenience for consumers constructing a typed bounded draft; history is only in companion events. */
export function ipv4DraftValue(view: IPv4WorkflowView): Pick<Draft, 'value' | 'valueFormat'> {
  return { value: serializeIPv4View(view), valueFormat: IPV4_DRAFT_FORMAT }
}
