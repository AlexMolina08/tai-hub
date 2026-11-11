import { ACCESS_MODEL_VERSION, validAccessProfile } from './access-model'
import { CLOSURE_MODEL_VERSION, validClosureProfile } from './closure-model'
import { FRAME_MODEL_VERSION, validFrameProfile } from './frame-model'
import { RELATION_MODEL_VERSION, validRelationProfile } from './relation-model'
import { SIGNAL_MODEL_VERSION, validSignalCases } from './signal-model'
import { STACK_MODEL_VERSION } from './stack-model'
import { requiredGates, type LabPackage, type EventBatch } from './model'
import { familyConflicts } from './partitions'
import { validateIPv4Activity, validateIPv4Event } from './ipv4-workflow'
import { validateLearningEvent } from './learning-context'

export class LabValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join('\n'))
    this.name = 'LabValidationError'
  }
}
type RecordValue = Record<string, unknown>
const states = ['planned', 'authored', 'review', 'correction', 'validated', 'withdrawn']
const phases = ['practice', 'immediate', 'reserved', 'delayed']
const record = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v)
const string = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(string) && new Set(v).size === v.length
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const date = (v: unknown) => string(v) && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v))
const fields = (v: RecordValue, names: string[]) => names.every(n => string(v[n]))
const inList = (v: unknown, values: readonly string[]) => typeof v === 'string' && values.includes(v)
const lists = (v: RecordValue, names: string[], nonempty = true) => names.every(n => strings(v[n]) && (!nonempty || v[n].length > 0))
const claims = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every(c => record(c) && fields(c, ['text', 'sourceId', 'locator']))
const options = (value: unknown, correctCount: number) => Array.isArray(value) && value.length >= 2
  && value.every(o => record(o) && fields(o, ['id', 'text', 'explanation']) && typeof o.correct === 'boolean')
  && value.filter(o => o.correct).length === correctCount && new Set(value.map(o => o.id)).size === value.length
function fail(issues: string[]): void { if (issues.length) throw new LabValidationError(issues) }

/** Structural checks and editorial gates are separate: an authored package can be inspected but cannot be studied. */
export function parsePackage(input: unknown, purpose: 'authoring' | 'study' = 'study'): LabPackage {
  if (!record(input) || input.schema !== 1 || input.privacy !== 'tai-lab-private'
    || !fields(input, ['id', 'version', 'title'])) throw new LabValidationError(['Paquete o versión de esquema no admitidos.'])
  const issues: string[] = []
  const collections = ['objectives', 'sources', 'lessons', 'activities', 'evidence',
    ...['sessions', 'exams'].filter(key => input[key] !== undefined)]
  for (const name of collections) {
    if (!Array.isArray(input[name]) || !(input[name] as unknown[]).every(record)) issues.push(`${name}: lista inválida`)
  }
  fail(issues)
  for (const name of collections) {
    const rows = input[name] as RecordValue[]
    const ids = rows.map(r => r.id)
    if (!ids.every(string) || new Set(ids).size !== ids.length) issues.push(`${name}: IDs vacíos o duplicados`)
  }
  for (const s of input.sources as RecordValue[]) {
    if (!fields(s, ['title', 'url']) || !inList(s.verification, ['candidate', 'verified'])
      || (s.verification === 'verified' && !fields(s, ['edition', 'locator', 'consultedOn']))
      || !inList(s.authority, ['primary', 'secondary', 'execution'])
      || !inList(s.rights, ['reference-only', 'original', 'licensed-private', 'open'])) issues.push(`${s.id}: fuente incompleta`)
    try { const u = new URL(String(s.url)); if (u.protocol !== 'https:' || u.username || u.password) throw new Error() }
    catch { issues.push(`${s.id}: URL de fuente no admitida`) }
  }
  for (const o of input.objectives as RecordValue[]) {
    if (!fields(o, ['unitId', 'topicId', 'statement']) || !inList(o.depth, ['A', 'R', 'R/A']) || !inList(o.state, states)
      || !lists(o, ['concepts', 'officialClauses', 'sourceIds', 'lessonIds', 'practiceIds', 'immediateIds', 'reservedIds', 'delayedIds'])) {
      issues.push(`${o.id}: objetivo sin conceptos, fuentes o destinos L/P/E`)
    }
  }
  for (const l of input.lessons as RecordValue[]) {
    if (!fields(l, ['version', 'title']) || !lists(l, ['objectiveIds', 'activityIds']) || !lists(l, ['prerequisites'], false)
      || !integer(l.minutes) || Number(l.minutes) < 1 || !inList(l.state, states) || !claims(l.claims)
      || !record(l.material) || !fields(l.material, ['resourceId', 'sectionId'])
      || !['explanation', 'workedExample'].every(k => Array.isArray(l[k]) && l[k].length > 0
        && l[k].every(s => record(s) && fields(s, ['title', 'body'])))) issues.push(`${l.id}: lección incompleta`)
  }
  const stageKinds = ['recover', 'understand', 'experiment', 'transfer', 'close']
  const stageMinutes = [[4, 5], [6, 8], [12, 15], [6, 8], [2, 4]]
  const indices = (value: unknown): value is number[] => Array.isArray(value) && value.every(integer) && new Set(value).size === value.length
  for (const session of (input.sessions ?? []) as RecordValue[]) {
    if (!fields(session, ['version', 'title']) || !lists(session, ['objectiveIds']) || !inList(session.state, states)
      || !Array.isArray(session.stages) || session.stages.length !== 5 || !session.stages.every(record)) {
      issues.push(`${session.id}: sesión incompleta`); continue
    }
    if (new Set(session.stages.map(stage => stage.id)).size !== 5) issues.push(`${session.id}: etapas duplicadas`)
    session.stages.forEach((stage, index) => {
      if (!fields(stage, ['id', 'title', 'instructions']) || stage.kind !== stageKinds[index]
        || !integer(stage.minutes) || Number(stage.minutes) < stageMinutes[index][0] || Number(stage.minutes) > stageMinutes[index][1]
        || !lists(stage, ['activityIds'], false) || !Array.isArray(stage.readings)
        || !stage.readings.every(reading => record(reading) && string(reading.lessonId)
          && indices(reading.explanationIndexes) && indices(reading.workedExampleIndexes)
          && reading.explanationIndexes.length + reading.workedExampleIndexes.length > 0)) {
        issues.push(`${session.id}: etapa inválida`); return
      }
      if (stage.kind !== 'close' && !(stage.activityIds as unknown[]).length && !stage.readings.length) issues.push(`${session.id}: etapa sin contenido`)
    })
  }
  for (const a of input.activities as RecordValue[]) {
    if (!fields(a, ['version', 'title', 'familyId', 'scenarioId', 'prompt', 'solution']) || !lists(a, ['objectiveIds'])
      || !inList(a.state, states) || !inList(a.phase, phases) || !lists(a, ['hints'], false) || !claims(a.claims)
      || !record(a.provenance) || !inList(a.provenance.kind, ['official-tai', 'official-other', 'adapted', 'original', 'didactic'])
      || !inList(a.provenance.status, ['eligible', 'annulled', 'disputed', 'unreconciled'])
      || !record(a.mode) || !inList(a.mode.kind, ['real', 'simulation', 'trace', 'documentary']) || !fields(a.mode, ['engine', 'version', 'limits'])) {
      issues.push(`${a.id}: actividad incompleta`)
      continue
    }
    if (a.mode.kind === 'documentary' && a.kind !== 'choice') {
      issues.push(`${a.id}: un caso documental requiere respuesta preparada, sin ejecutor`)
    }
    if (['official-tai', 'official-other', 'adapted'].includes(String(a.provenance.kind)) && !string(a.provenance.originalId)) {
      issues.push(`${a.id}: falta procedencia original`)
    }
    if (a.evaluationIntent !== undefined && (a.phase !== 'delayed' || !inList(a.evaluationIntent, ['retention', 'transfer']))) {
      issues.push(`${a.id}: intención de evaluación inválida`)
    }
    if (a.learning !== undefined) {
      const learning = a.learning
      if (!record(learning) || !lists(learning, ['rechecksDiagnosticIds'], false) || !Array.isArray(learning.diagnostics)
        || !learning.diagnostics.every(d => record(d) && string(d.id) && lists(d, ['objectiveIds'])
          && (d.objectiveIds as string[]).every(id => (a.objectiveIds as string[]).includes(id))
          && inList(d.severity, ['ordinary', 'critical']) && (a.kind === 'choice'
            ? strings(d.choiceOptionIds) && d.choiceOptionIds.length > 0 && Array.isArray(a.options)
              && d.choiceOptionIds.every(id => (a.options as RecordValue[]).some(o => o.id === id && o.correct === false))
            : d.choiceOptionIds === undefined))) issues.push(`${a.id}: diagnósticos preparados inválidos`)
    }
    if (a.kind === 'choice') {
      if (!options(a.options, 1)) issues.push(`${a.id}: opciones inválidas`)
    } else if (a.kind === 'sql') {
      if (typeof a.starter !== 'string' || !string(a.referenceQuery) || !inList(a.comparison, ['bag', 'set', 'ordered'])
        || !Array.isArray(a.datasets) || a.datasets.length < 2
        || !a.datasets.every(d => record(d) && fields(d, ['id', 'setup']))) issues.push(`${a.id}: casos SQL insuficientes`)
    } else if (a.kind === 'code') {
      if (!inList(a.language, ['python', 'javascript']) || typeof a.starter !== 'string' || a.starter.length > 50_000
        || !Array.isArray(a.datasets) || a.datasets.length < 2 || a.datasets.length > 12
        || !a.datasets.every(d => record(d) && string(d.id) && d.input !== undefined
          && JSON.stringify(d.input).length <= 16_000 && Array.isArray(d.expectedOutput)
          && d.expectedOutput.length <= 100 && d.expectedOutput.every(v => typeof v === 'string')
          && JSON.stringify(d.expectedOutput).length <= 16_000)
        || new Set(a.datasets.map(d => (d as RecordValue).id)).size !== a.datasets.length) issues.push(`${a.id}: casos de código inválidos`)
    } else if (a.kind === 'html-css') {
      if (!record(a.starter) || typeof a.starter.html !== 'string' || typeof a.starter.css !== 'string'
        || a.starter.html.length + a.starter.css.length > 50_000
        || !Array.isArray(a.cases) || a.cases.length < 2 || a.cases.length > 8
        || !a.cases.every(c => record(c) && string(c.id) && integer(c.width) && Number(c.width) >= 320 && Number(c.width) <= 1440
          && Array.isArray(c.checks) && c.checks.length > 0 && c.checks.length <= 30
          && c.checks.every(k => record(k) && string(k.selector) && k.selector.length <= 200
            && inList(k.kind, ['count', 'text', 'style', 'attribute']) && typeof k.expected === 'string' && k.expected.length <= 2000
            && (!['style', 'attribute'].includes(String(k.kind)) || (string(k.property) && /^[a-zA-Z-]{1,64}$/.test(k.property)))))
        || new Set(a.cases.map(c => (c as RecordValue).id)).size !== a.cases.length) issues.push(`${a.id}: casos HTML/CSS inválidos`)
    } else if (a.kind === 'closure-model') {
      if (a.phase !== 'practice' || a.mode.kind !== 'simulation' || a.mode.version !== CLOSURE_MODEL_VERSION
        || !validClosureProfile(a.profile)) issues.push(`${a.id}: perfil de dependencias inválido`)
    } else if (a.kind === 'relation-model') {
      if (a.phase !== 'practice' || a.mode.kind !== 'simulation' || a.mode.version !== RELATION_MODEL_VERSION
        || !validRelationProfile(a.profile)) issues.push(`${a.id}: perfil E/R inválido`)
    } else if (a.kind === 'stack-model') {
      if (a.phase !== 'practice' || a.mode.kind !== 'simulation' || a.mode.version !== STACK_MODEL_VERSION)
        issues.push(`${a.id}: perfil de pila inválido`)
    } else if (a.kind === 'access-model') {
      if (a.phase !== 'practice' || a.mode.kind !== 'simulation' || a.mode.version !== ACCESS_MODEL_VERSION
        || !validAccessProfile(a.profile)) issues.push(`${a.id}: perfil de acceso inválido`)
    } else if (a.kind === 'frame-model') {
      if (a.phase !== 'practice' || a.mode.kind !== 'simulation' || a.mode.version !== FRAME_MODEL_VERSION
        || !validFrameProfile(a.profile)) issues.push(`${a.id}: perfil de símbolos y tramas inválido`)
    } else if (a.kind === 'signal-model') {
      if (a.phase !== 'practice' || a.mode.kind !== 'simulation' || a.mode.version !== SIGNAL_MODEL_VERSION
        || !validSignalCases(a.cases)) issues.push(`${a.id}: casos del modelo de señales inválidos`)
    } else if (a.kind === 'ipv4-model') {
      try { validateIPv4Activity(a) } catch (error) { issues.push(`${a.id}: ${String(error)}`) }
    } else issues.push(`${a.id}: modalidad no soportada`)
  }
  for (const form of (input.exams ?? []) as RecordValue[]) {
    if (!fields(form, ['version', 'title']) || !inList(form.state, states)
      || !inList(form.kind, ['topic', 'case-iii', 'full-iii']) || !inList(form.partition, ['training', 'reserved'])
      || !integer(form.durationMinutes) || Number(form.durationMinutes) < 1 || Number(form.durationMinutes) > 120
      || !Array.isArray(form.sections) || form.sections.length !== (form.kind === 'full-iii' ? 2 : 1)) {
      issues.push(`${form.id}: formato de examen inválido`); continue
    }
    if (form.kind === 'full-iii' && form.durationMinutes !== 120) issues.push(`${form.id}: el examen completo dura 120 minutos`)
    const ids = new Set<unknown>()
    form.sections.forEach((section, index) => {
      const general = form.kind === 'full-iii' && index === 0
      const practical = form.kind === 'case-iii' || index === 1
      if (!record(section) || !string(section.title) || (practical && !string(section.scenario))
        || (section.scenario !== undefined && !string(section.scenario))
        || !Array.isArray(section.questions) || section.questions.length !== (general ? 80 : 20)
        || !Array.isArray(section.reserves) || section.reserves.length !== (form.kind === 'topic' ? 0 : 5)) {
        issues.push(`${form.id}: parte de examen incompleta`); return
      }
      for (const question of [...section.questions, ...section.reserves]) {
        const provenance = question?.provenance
        if (!record(question) || !fields(question, ['id', 'prompt', 'familyId', 'scenarioId'])
          || !lists(question, ['objectiveIds'], form.kind !== 'full-iii') || !claims(question.claims)
          || !record(provenance) || !inList(provenance.kind, ['official-tai', 'adapted', 'original'])
          || (provenance.kind !== 'original' && !string(provenance.originalId))
          || !inList(provenance.status, ['eligible', 'annulled']) || !options(question.options, provenance.status === 'annulled' ? 0 : 1)
          || ids.has(question.id)) {
          issues.push(`${form.id}: pregunta de examen inválida o duplicada`); continue
        }
        ids.add(question.id)
        if (form.partition === 'reserved' && provenance.kind !== 'original') {
          issues.push(`${form.id}: una evaluación reservada requiere preguntas originales`)
        }
      }
    })
  }
  for (const e of input.evidence as RecordValue[]) {
    if (!fields(e, ['subjectId', 'subjectVersion', 'environment', 'procedure', 'expected', 'observed', 'artifact'])
      || !inList(e.gate, requiredGates) || !inList(e.method, ['source-review', 'execution', 'automated-browser', 'physical-device', 'manual'])
      || !inList(e.result, ['pass', 'fail']) || !date(e.recordedAt) || !/^[a-f0-9]{64}$/.test(String(e.sha256))) issues.push(`${e.id}: evidencia incompleta`)
  }
  fail(issues)
  const pack = input as unknown as LabPackage
  const objectives = new Map(pack.objectives.map(o => [o.id, o]))
  const lessons = new Map(pack.lessons.map(l => [l.id, l]))
  const activities = new Map(pack.activities.map(a => [a.id, a]))
  const diagnosticIds = pack.activities.flatMap(a => a.learning?.diagnostics.map(d => d.id) ?? [])
  if (new Set(diagnosticIds).size !== diagnosticIds.length) issues.push('IDs de diagnóstico duplicados')
  for (const a of pack.activities) for (const id of a.learning?.rechecksDiagnosticIds ?? []) {
    const diagnostic = pack.activities.flatMap(v => v.learning?.diagnostics ?? []).find(d => d.id === id)
    if (!diagnostic || !diagnostic.objectiveIds.every(id => a.objectiveIds.includes(id))) issues.push(`${a.id}: comprobación de diagnóstico inexistente o de otro objetivo`)
  }
  const sources = new Map(pack.sources.map(s => [s.id, s]))
  const reference = (id: string, ids: string[], known: Map<string, unknown>) => {
    for (const ref of ids) if (!known.has(ref)) issues.push(`${id}: referencia inexistente ${ref}`)
  }
  for (const o of pack.objectives) {
    reference(o.id, o.sourceIds, sources)
    if (o.state === 'planned') continue
    reference(o.id, o.lessonIds, lessons)
    for (const [key, phase] of [['practiceIds', 'practice'], ['immediateIds', 'immediate'], ['reservedIds', 'reserved'], ['delayedIds', 'delayed']] as const) {
      reference(o.id, o[key], activities)
      for (const id of o[key]) {
        const a = activities.get(id)
        if (a && (a.phase !== phase || !a.objectiveIds.includes(o.id))) issues.push(`${o.id}: destino ${id} no cubre objetivo/fase`)
      }
    }
    for (const id of o.lessonIds) if (!lessons.get(id)?.objectiveIds.includes(o.id)) issues.push(`${o.id}: lección sin vínculo inverso`)
  }
  for (const a of pack.activities) {
    reference(a.id, a.objectiveIds, objectives)
  }
  issues.push(...familyConflicts(pack.activities, [pack]))
  for (const l of pack.lessons) {
    reference(l.id, l.objectiveIds, objectives)
    reference(l.id, l.prerequisites, objectives)
    reference(l.id, l.activityIds, activities)
    const own = l.activityIds.map(id => activities.get(id)).filter(a => a !== undefined)
    if (own.some(a => ['reserved', 'delayed'].includes(a.phase))) issues.push(`${l.id}: reserva expuesta en lección`)
    if (l.state === 'validated' && (new Set(own.filter(a => a.phase === 'practice').map(a => a.familyId)).size < 2
      || own.filter(a => a.phase === 'immediate').length < 3)) issues.push(`${l.id}: faltan familias o cierre`)
  }
  for (const session of pack.sessions ?? []) {
    if (lessons.has(session.id) || activities.has(session.id)) issues.push(`${session.id}: identidad de sesión compartida con otro contenido`)
    reference(session.id, session.objectiveIds, objectives)
    const coveredObjectives = new Set<string>()
    const ids = session.stages.flatMap(stage => stage.activityIds)
    if (new Set(ids).size !== ids.length) issues.push(`${session.id}: actividad repetida entre etapas`)
    reference(session.id, ids, activities)
    for (const id of ids) {
      const activity = activities.get(id)
      activity?.objectiveIds.forEach(id => coveredObjectives.add(id))
      if (activity && (!['practice', 'immediate'].includes(activity.phase) || activity.provenance.status !== 'eligible')) {
        issues.push(`${session.id}: reserva o actividad no elegible expuesta en sesión`)
      }
      if (session.state === 'validated' && activity?.state !== 'validated') issues.push(`${session.id}: actividad todavía no validada`)
    }
    for (const stage of session.stages) for (const reading of stage.readings) {
      const lesson = lessons.get(reading.lessonId)
      lesson?.objectiveIds.forEach(id => coveredObjectives.add(id))
      if (!lesson || reading.explanationIndexes.some(index => index >= lesson.explanation.length)
        || reading.workedExampleIndexes.some(index => index >= lesson.workedExample.length)) issues.push(`${session.id}: lectura inexistente`)
      if (session.state === 'validated' && lesson?.state !== 'validated') issues.push(`${session.id}: lectura todavía no validada`)
    }
    for (const id of session.objectiveIds) if (!coveredObjectives.has(id)) issues.push(`${session.id}: objetivo ${id} sin cobertura en las etapas`)
  }
  for (const form of pack.exams ?? []) {
    if (lessons.has(form.id) || activities.has(form.id) || pack.sessions?.some(session => session.id === form.id)) {
      issues.push(`${form.id}: identidad de examen compartida con otro contenido`)
    }
    for (const { questions, reserves } of form.sections) for (const question of [...questions, ...reserves]) {
      reference(question.id, question.objectiveIds, objectives)
      reference(question.id, question.claims.map(c => c.sourceId), sources)
    }
  }
  for (const subject of [...pack.lessons, ...pack.activities, ...(pack.sessions ?? []), ...(pack.exams ?? [])]) {
    if ('claims' in subject) for (const c of subject.claims) reference(subject.id, [c.sourceId], sources)
    if (subject.state !== 'validated') continue
    for (const gate of requiredGates) {
      const matches = pack.evidence.filter(e => e.subjectId === subject.id && e.subjectVersion === subject.version && e.gate === gate)
      if (!matches.some(e => e.result === 'pass') || matches.some(e => e.result === 'fail')) issues.push(`${subject.id}: puerta ${gate} sin superar para esta versión`)
    }
  }
  for (const a of pack.activities) {
    if (a.state === 'validated' && (a.provenance.status !== 'eligible'
      || (a.phase === 'practice' && a.hints.length < 3)
      || (a.phase !== 'practice' && a.hints.length > 0))) issues.push(`${a.id}: procedencia o pistas incompatibles con evaluación`)
  }
  if (purpose === 'study') {
    for (const source of pack.sources) if (source.verification !== 'verified') issues.push(`${source.id}: fuente todavía candidata`)
    if ((!pack.lessons.length || !pack.activities.length || !pack.objectives.length) && !pack.exams?.length) issues.push('Paquete sin contenido estudiable')
    for (const s of [...pack.objectives, ...pack.lessons, ...pack.activities, ...(pack.sessions ?? []), ...(pack.exams ?? [])]) if (s.state !== 'validated') issues.push(`${s.id}: contenido todavía no validado`)
  }
  fail(issues)
  return structuredClone(pack)
}

export function parseEventBatch(input: unknown, accountId: string): EventBatch {
  if (!record(input) || input.schema !== 1 || input.privacy !== 'tai-lab-private' || input.accountId !== accountId
    || !Array.isArray(input.events)) throw new LabValidationError(['Historial incompatible o de otra cuenta.'])
  const issues: string[] = []
  for (const e of input.events) {
    if (!record(e) || !fields(e, ['id', 'deviceId']) || e.accountId !== accountId || !date(e.createdAt)) {
      issues.push('Evento inválido o de otra cuenta'); continue
    }
    if (e.kind === 'exposure') {
      if (!string(e.familyId) || !inList(e.reason, ['presented', 'solution', 'external'])) issues.push(`${e.id}: exposición inválida`)
    } else if (e.kind === 'note') {
      const target = e.target
      if (!record(target) || !fields(target, ['packageId', 'packageVersion'])
        || !(target.kind === 'activity' && target.purpose === 'prediction' && fields(target, ['activityId', 'activityVersion'])
          || target.kind === 'session' && target.purpose === 'reflection' && fields(target, ['sessionId', 'sessionVersion']))
        || !lists(e, ['parentIds'], false) || (e.parentIds as string[]).includes(String(e.id))
        || typeof e.value !== 'string' || e.value.length > 4000) issues.push(`${e.id}: nota personal inválida`)
    } else if (e.kind === 'exam-revision') {
      if (!fields(e, ['packageId', 'packageVersion', 'examId', 'examVersion', 'runId'])
        || !lists(e, ['parentIds'], false) || (e.parentIds as string[]).includes(String(e.id))
        || ((e.parentIds as string[]).length === 0) !== (e.id === e.runId)
        || !date(e.startedAt) || !date(e.deadlineAt)
        || Date.parse(String(e.deadlineAt)) <= Date.parse(String(e.startedAt))
        || Date.parse(String(e.createdAt)) < Date.parse(String(e.startedAt))
        || !(e.submitted === null || inList(e.submitted, ['manual', 'expired']))
        || (e.submitted === 'expired' && Date.parse(String(e.createdAt)) < Date.parse(String(e.deadlineAt)))
        || ((e.submitted === null || (e.parentIds as string[]).length < 2) && e.submitted !== 'expired'
          && Date.parse(String(e.createdAt)) >= Date.parse(String(e.deadlineAt)))
        || !Array.isArray(e.answers) || e.answers.length > 110
        || !e.answers.every(answer => Array.isArray(answer) && answer.length === 2 && answer.every(string))
        || new Set(e.answers.map(answer => answer[0])).size !== e.answers.length
        || (e.id === e.runId && (e.answers.length > 0 || e.submitted !== null || e.createdAt !== e.startedAt))) {
        issues.push(`${e.id}: revisión de examen inválida`)
      }
    } else if (e.kind === 'session-position') {
      if (!fields(e, ['packageId', 'packageVersion', 'sessionId', 'sessionVersion', 'stageId'])
        || (e.activityId !== null && !string(e.activityId)) || typeof e.completed !== 'boolean') issues.push(`${e.id}: posición de sesión inválida`)
    } else if (e.kind === 'attempt' || e.kind === 'draft' || e.kind === 'assistance') {
      if (!fields(e, ['activityId', 'activityVersion', 'packageId', 'packageVersion'])) issues.push(`${e.id}: referencia de contenido incompleta`)
      if (e.kind === 'draft') {
        if (!string(e.attemptGroupId) || !lists(e, ['parentIds'], false) || (e.parentIds as string[]).includes(String(e.id))
          || typeof e.value !== 'string' || !integer(e.position)) issues.push(`${e.id}: borrador inválido`)
      } else if (e.kind === 'assistance') {
        if (!string(e.attemptGroupId) || !integer(e.hintCount) || typeof e.solutionViewed !== 'boolean') issues.push(`${e.id}: ayuda inválida`)
      } else if (!fields(e, ['familyId', 'attemptGroupId', 'feedback', 'gradingVersion']) || !lists(e, ['objectiveIds'])
        || !integer(e.ordinal) || Number(e.ordinal) < 1 || !integer(e.hintCount) || !integer(e.activeMs)
        || typeof e.solutionViewed !== 'boolean' || !inList(e.phase, phases)
        || !inList(e.outcome, e.ipv4 === undefined ? ['correct', 'incorrect', 'omitted'] : ['correct', 'incorrect', 'omitted', 'partial']) || (e.answer !== null && typeof e.answer !== 'string')
        || (e.outcome === 'omitted') !== (e.answer === null)) issues.push(`${e.id}: intento inválido`)
    } else if (['ipv4-prediction', 'ipv4-reveal', 'ipv4-reset', 'learning-context'].includes(String(e.kind))) {
      // The dedicated adapter checks the versioned action shape below.
    } else issues.push(`${e.id}: tipo de evento desconocido`)
    try { validateIPv4Event(e) } catch (error) { issues.push(`${e.id}: ${String(error)}`) }
    try { validateLearningEvent(e) } catch (error) { issues.push(`${e.id}: ${String(error)}`) }
  }
  fail(issues)
  return structuredClone(input) as unknown as EventBatch
}
