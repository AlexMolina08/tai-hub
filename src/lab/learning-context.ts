import type { EventBase, LabEvent, LearningClock, LearningContext, LearningTarget } from './model'

export const LEARNING_CONTEXT_VERSION = 2 as const
export const MAX_LEARNING_PARENTS = 256
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 1000
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every(text) && new Set(v).size === v.length
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => k in v)
function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
const reciprocal = (e: LabEvent) => e.kind === 'exposure' || e.kind === 'assistance' || e.kind === 'ipv4-prediction'
  || e.kind === 'attempt' && !e.ipv4
const refKeys = ['packageId', 'packageVersion', 'activityId', 'activityVersion', 'attemptGroupId'] as const
export const sameLearningTarget = (a: LearningTarget, b: LearningTarget) => a.kind === b.kind && (a.kind === 'activity' && b.kind === 'activity'
  ? refKeys.every(k => a[k] === b[k]) : a.kind === 'lesson' && b.kind === 'lesson'
    && ['packageId', 'packageVersion', 'lessonId', 'lessonVersion'].every(k => a[k as keyof typeof a] === b[k as keyof typeof b]))

/** Declared device date, not a remote clock or proof of elapsed real-world time. */
export function captureLearningClock(createdAt: string, clockSessionId: string, monotonicMs: number,
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone): LearningClock {
  const time = Date.parse(createdAt)
  requireValue(Number.isFinite(time) && text(clockSessionId) && Number.isFinite(monotonicMs) && monotonicMs >= 0, 'Reloj de aprendizaje inválido.')
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(time)
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]))
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  return { day: `${p.year}-${p.month}-${p.day}`, zone, offsetMinutes: (local - Math.floor(time / 1000) * 1000) / 60000,
    clockSessionId, monotonicMs }
}

export function validateLearningEvent(value: unknown): void {
  if (!object(value)) return
  const e = value
  if (e.learningContextId !== undefined) requireValue(text(e.learningContextId)
    && (['exposure', 'assistance', 'ipv4-prediction'].includes(String(e.kind)) || e.kind === 'attempt' && e.ipv4 === undefined),
  'Referencia de contexto de aprendizaje inválida.')
  if (e.diagnosticIds !== undefined) requireValue(e.kind === 'attempt' && ids(e.diagnosticIds) && e.diagnosticIds.length <= 100,
    'Diagnósticos de intento inválidos.')
  if (Array.isArray(e.diagnosticIds) && e.diagnosticIds.length) requireValue(e.outcome === 'incorrect', 'Un diagnóstico de error exige un resultado incorrecto.')
  if (e.kind !== 'learning-context') return
  const v2 = e.contractVersion === 2
  requireValue(exact(e, ['id', 'accountId', 'deviceId', 'createdAt', 'kind', 'contractVersion', 'studySessionId', 'action', 'target',
    'factIds', 'parentIds', 'presentationId', 'clock', ...(v2 && e.action === 'present' ? ['referenceVisible'] : [])])
    && ['id', 'accountId', 'deviceId', 'createdAt', 'studySessionId'].every(k => text(e[k]))
    && Number.isFinite(Date.parse(String(e.createdAt))) && (e.contractVersion === 1 || v2)
    && ['present', 'answer', 'help', 'reading', 'reset', ...(v2 ? ['reference'] : [])].includes(String(e.action))
    && (!v2 || e.action !== 'present' || typeof e.referenceVisible === 'boolean'), 'Contexto de aprendizaje incompatible.')
  requireValue(ids(e.factIds) && e.factIds.length <= 8 && ids(e.parentIds) && e.parentIds.length <= MAX_LEARNING_PARENTS
    && !e.factIds.includes(String(e.id)) && !e.parentIds.includes(String(e.id))
    && (e.presentationId === null || text(e.presentationId)), 'Enlaces de aprendizaje inválidos.')
  const target = e.target
  requireValue(object(target) && (target.kind === 'activity' && exact(target, ['kind', ...refKeys]) && refKeys.every(k => text(target[k]))
    || target.kind === 'lesson' && exact(target, ['kind', 'packageId', 'packageVersion', 'lessonId', 'lessonVersion'])
      && ['packageId', 'packageVersion', 'lessonId', 'lessonVersion'].every(k => text(target[k]))), 'Destino de aprendizaje inválido.')
  requireValue(e.action === 'reading' ? target.kind === 'lesson' && e.factIds.length === 0 && e.presentationId === null
    : target.kind === 'activity' && (e.action === 'reference' ? e.factIds.length === 0 : e.factIds.length > 0)
      && (e.action === 'present' ? e.presentationId === null
      : text(e.presentationId) && e.parentIds.includes(e.presentationId)), 'Presentación o hechos de aprendizaje incompletos.')
  const clock = e.clock
  requireValue(object(clock) && exact(clock, ['day', 'zone', 'offsetMinutes', 'clockSessionId', 'monotonicMs'])
    && text(clock.day) && text(clock.zone) && text(clock.clockSessionId) && typeof clock.monotonicMs === 'number'
    && Number.isFinite(clock.monotonicMs) && clock.monotonicMs >= 0 && typeof clock.offsetMinutes === 'number', 'Reloj de aprendizaje incompleto.')
  const expected = captureLearningClock(String(e.createdAt), clock.clockSessionId, clock.monotonicMs, clock.zone)
  requireValue(expected.day === clock.day && expected.offsetMinutes === clock.offsetMinutes, 'Día, zona y fecha de aprendizaje incoherentes.')
}

/** Known contradictions reject the entire merge; missing references remain pending. */
export function validateLearningHistory(events: readonly LabEvent[]) {
  const all = new Map(events.map(e => [e.id, e])), contexts = events.filter((e): e is LearningContext => e.kind === 'learning-context')
  const missing = new Set<string>(), incomplete = new Set<string>(), ownership = new Map<string, string>()
  const incoming = new Map<string, number>(), children = new Map<string, string[]>()
  for (const c of contexts) {
    validateLearningEvent(c)
    let count = 0
    for (const id of c.parentIds) {
      const parent = all.get(id)
      if (!parent) { missing.add(id); incomplete.add(c.id); continue }
      requireValue(parent.kind === 'learning-context' && parent.accountId === c.accountId, 'Padre de aprendizaje de otro tipo o cuenta.')
      count += 1
      const descendants = children.get(id) ?? []; descendants.push(c.id); children.set(id, descendants)
    }
    incoming.set(c.id, count)
    if (c.presentationId) {
      const p = all.get(c.presentationId)
      if (!p) { missing.add(c.presentationId); incomplete.add(c.id) }
      else requireValue(p.kind === 'learning-context' && p.action === 'present' && p.accountId === c.accountId
        && sameLearningTarget(c.target, p.target), 'Presentación de otra cuenta, edición o grupo.')
    }
    const facts: LabEvent[] = []
    for (const id of c.factIds) {
      requireValue(!ownership.has(id) || ownership.get(id) === c.id, 'Un hecho tiene dos contextos de origen.')
      ownership.set(id, c.id)
      const f = all.get(id)
      if (!f) { missing.add(id); incomplete.add(c.id); continue }
      requireValue(f.accountId === c.accountId && f.deviceId === c.deviceId, 'Hecho de aprendizaje de otra cuenta o dispositivo.')
      requireValue(c.target.kind === 'activity' && (f.kind === 'exposure'
        || 'attemptGroupId' in f && 'activityVersion' in f && refKeys.every(k => f[k] === (c.target as Extract<LearningTarget, {kind:'activity'}>)[k])),
      'Hecho de otra edición o grupo.')
      if (reciprocal(f)) requireValue('learningContextId' in f && f.learningContextId === c.id, 'Un hecho antiguo no acredita un contexto nuevo.')
      facts.push(f)
    }
    if (facts.length === c.factIds.length) {
      const principal = c.action === 'answer' ? facts.find(f => f.kind === 'attempt' && !f.ipv4 || f.kind === 'ipv4-prediction')
        : c.action === 'present' ? facts.find(f => f.kind === 'exposure' && f.reason === 'presented')
          : c.action === 'help' ? facts.find(f => f.kind === 'assistance') : facts.find(f => f.kind === 'ipv4-reset')
      requireValue(c.action === 'reading' || c.action === 'reference' || !!principal && principal.createdAt === c.createdAt, 'El contexto no conserva el instante del hecho original.')
      requireValue(c.action === 'reading' || c.action === 'reference' || c.action === 'present' && facts.length === 1 && facts[0].kind === 'exposure' && facts[0].reason === 'presented'
        || c.action === 'answer' && facts.length === 1 && (facts[0].kind === 'attempt' && !facts[0].ipv4 || facts[0].kind === 'ipv4-prediction')
        || c.action === 'help' && facts.some(f => f.kind === 'assistance') && facts.every(f => f.kind === 'assistance' || f.kind === 'exposure' && f.reason === 'solution')
        || c.action === 'reset' && facts.length === 1 && facts[0].kind === 'ipv4-reset', 'Hechos incompatibles con la acción de aprendizaje.')
    }
  }
  for (const f of events) {
    validateLearningEvent(f)
    if (!('learningContextId' in f) || !f.learningContextId) continue
    const c = all.get(f.learningContextId)
    if (!c) { missing.add(f.learningContextId); continue }
    requireValue(c.kind === 'learning-context' && c.accountId === f.accountId && c.factIds.includes(f.id), 'Reciprocidad de aprendizaje inválida.')
  }
  const ready = contexts.filter(c => incoming.get(c.id) === 0).map(c => c.id)
  for (let i = 0; i < ready.length; i++) for (const child of children.get(ready[i]) ?? []) {
    if (incomplete.has(ready[i])) incomplete.add(child)
    const count = incoming.get(child)! - 1; incoming.set(child, count)
    if (count === 0) ready.push(child)
  }
  requireValue(ready.length === contexts.length, 'Ciclo en contextos de aprendizaje.')
  return { missingIds: [...missing].sort(), incompleteContextIds: [...incomplete].sort() }
}

export function learningFrontier(events: readonly LabEvent[], accountId: string): string[] {
  const contexts = events.filter((e): e is LearningContext => e.kind === 'learning-context' && e.accountId === accountId)
  const parents = new Set(contexts.flatMap(c => c.parentIds))
  return contexts.filter(c => !parents.has(c.id)).map(c => c.id).sort()
}
export function learningPresentation(events: readonly LabEvent[], accountId: string, target: LearningTarget): {
  status: 'none' | 'pending' | 'answered' | 'ambiguous'; presentation?: LearningContext; candidates: LearningContext[]
} {
  const own = events.filter(e => e.accountId === accountId), incomplete = new Set(validateLearningHistory(own).incompleteContextIds)
  const contexts = own.filter((e): e is LearningContext => e.kind === 'learning-context' && sameLearningTarget(e.target, target))
  const presentations = contexts.filter(c => c.action === 'present')
  if (contexts.some(c => c.action === 'answer' && incomplete.has(c.id))) return { status: 'ambiguous', candidates: presentations }
  const answered = new Set(contexts.filter(c => c.action === 'answer' && !incomplete.has(c.id)).map(c => c.presentationId))
  const pending = presentations.filter(c => !answered.has(c.id))
  if (pending.some(c => incomplete.has(c.id)) || pending.length > 1) return { status: 'ambiguous', candidates: pending }
  if (pending.length === 1) return { status: 'pending', presentation: pending[0], candidates: pending }
  return { status: presentations.length ? 'answered' : 'none', candidates: presentations }
}

export interface LearningContextPlanInput {
  id: string
  action: LearningContext['action']
  target: LearningTarget
  presentationId: string | null
  studySessionId: string
  clock: LearningClock
  facts: LabEvent[]
  history: readonly LabEvent[]
  /** Explicit availability on a new presentation; absent callers are isolated activity views. */
  referenceVisible?: boolean
  /** Required for reading/reference, which have no existing fact as their origin. */
  base?: Omit<EventBase, 'id'>
}
export type LearningContextPlan = { status: 'captured'; context: LearningContext; events: LabEvent[] }
  | { status: 'historical'; context: null; events: LabEvent[]; reason: string }

/** Build once and retain the returned atomic batch for retries; never re-plan a pending write. */
export function planLearningContext(input: LearningContextPlanInput): LearningContextPlan {
  const facts = input.facts.filter(f => input.action === 'answer' ? f.kind === 'attempt' && !f.ipv4 || f.kind === 'ipv4-prediction'
    : input.action === 'present' ? f.kind === 'exposure' && f.reason === 'presented'
      : input.action === 'help' ? f.kind === 'assistance' || f.kind === 'exposure' && f.reason === 'solution'
        : input.action === 'reset' ? f.kind === 'ipv4-reset' : false)
  const principal = input.action === 'help' ? facts.find(f => f.kind === 'assistance') : facts[0]
  const base = principal ?? input.base
  requireValue(!!base, 'Falta el hecho original o la base de lectura.')
  const parents = [...new Set([...learningFrontier(input.history, base.accountId), ...(input.presentationId ? [input.presentationId] : [])])].sort()
  const degrade = (reason: string): LearningContextPlan => ({ status: 'historical', context: null, events: structuredClone(input.facts), reason })
  if (parents.length > MAX_LEARNING_PARENTS) return degrade('Demasiadas ramas concurrentes; respuesta conservada sin nueva evidencia de aprendizaje.')
  const history = new Map(input.history.map(e => [e.id, e]))
  for (const f of facts) {
    const previous = history.get(f.id)
    if (previous && reciprocal(f) && (!('learningContextId' in previous) || previous.learningContextId !== input.id)) {
      return degrade('Hecho histórico conservado sin añadirle metadatos retrospectivos.')
    }
  }
  const context: LearningContext = { kind: 'learning-context', contractVersion: LEARNING_CONTEXT_VERSION, id: input.id, accountId: base.accountId,
    deviceId: base.deviceId, createdAt: base.createdAt, studySessionId: input.studySessionId, action: input.action,
    target: structuredClone(input.target), factIds: facts.map(f => f.id), parentIds: parents,
    presentationId: input.presentationId, clock: structuredClone(input.clock),
    ...(input.action === 'present' ? { referenceVisible: input.referenceVisible ?? false } : {}) }
  const factIds = new Set(context.factIds)
  const copied = structuredClone(input.facts).map(f => factIds.has(f.id) && reciprocal(f) ? { ...f, learningContextId: context.id } : f)
  const events: LabEvent[] = [...copied, context]
  // Merge checking is still performed by history.ts; this catches programming mistakes before a write.
  const merged = new Map(input.history.map(e => [e.id, e])); events.forEach(e => merged.set(e.id, e))
  validateLearningHistory([...merged.values()])
  return { status: 'captured', context, events }
}
