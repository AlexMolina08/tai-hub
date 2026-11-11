import type { ExamForm, ExamQuestion, ExamRevision, ExamSection, LabEvent, LabPackage } from './model'

export function examRevisions(events: LabEvent[], accountId: string, pack: LabPackage, form: ExamForm) {
  return events.filter((event): event is ExamRevision => event.kind === 'exam-revision' && event.accountId === accountId
    && event.packageId === pack.id && event.packageVersion === pack.version
    && event.examId === form.id && event.examVersion === form.version)
}

export function examHeads(revisions: ExamRevision[]) {
  const parents = new Set(revisions.flatMap(revision => revision.parentIds))
  return revisions.filter(revision => !parents.has(revision.id))
}

const examKey = (revision: ExamRevision) => JSON.stringify([
  revision.accountId, revision.packageId, revision.packageVersion, revision.examId, revision.examVersion,
  revision.runId, revision.startedAt, revision.deadlineAt,
])

/** Check known edges on every merge, including when an ancestor arrives later. */
export function validateExamHistory(events: LabEvent[]) {
  const revisions = events.filter((event): event is ExamRevision => event.kind === 'exam-revision')
  const byId = new Map(events.map(event => [event.id, event]))
  const incoming = new Map<string, number>()
  const children = new Map<string, string[]>()
  for (const revision of revisions) {
    const parents: ExamRevision[] = []
    for (const id of revision.parentIds) {
      const parent = byId.get(id)
      if (!parent) continue
      if (parent.kind !== 'exam-revision' || examKey(parent) !== examKey(revision)
        || Date.parse(parent.createdAt) > Date.parse(revision.createdAt)) {
        throw new Error('La revisión enlaza con otro examen, intento o fecha incompatible.')
      }
      parents.push(parent)
      const descendants = children.get(id) ?? []
      descendants.push(revision.id)
      children.set(id, descendants)
    }
    incoming.set(revision.id, parents.length)
    const terminal = parents.filter(parent => parent.submitted !== null)
    const resolving = revision.parentIds.length > 1
    const sameAnswers = (parent: ExamRevision) => JSON.stringify(parent.answers) === JSON.stringify(revision.answers)
    if (terminal.length && (!resolving || (parents.length === revision.parentIds.length
      && !terminal.some(parent => parent.submitted === revision.submitted && sameAnswers(parent))))) {
      throw new Error('La entrega del examen es inmutable.')
    }
    if (parents.length === revision.parentIds.length && parents.length
      && (resolving || revision.submitted) && !parents.some(sameAnswers)) {
      throw new Error('La entrega o resolución debe conservar una hoja de respuestas guardada.')
    }
    if (!terminal.length && parents.length === revision.parentIds.length && resolving && revision.submitted === 'manual') {
      throw new Error('Resuelve las revisiones del examen antes de entregarlo.')
    }
  }
  const ready = revisions.filter(revision => incoming.get(revision.id) === 0).map(revision => revision.id)
  for (let i = 0; i < ready.length; i++) {
    for (const child of children.get(ready[i]) ?? []) {
      const count = incoming.get(child)! - 1
      incoming.set(child, count)
      if (count === 0) ready.push(child)
    }
  }
  if (ready.length !== revisions.length) throw new Error('Ciclo entre revisiones de examen.')
}

export function examRunReady(revisions: ExamRevision[], runId: string) {
  const known = new Set(revisions.map(revision => revision.id))
  return known.has(runId) && revisions.every(revision => revision.parentIds.every(id => known.has(id)))
}

export function examAnswers(form: ExamForm, revision: ExamRevision) {
  if (Date.parse(revision.deadlineAt) - Date.parse(revision.startedAt) !== form.durationMinutes * 60_000) {
    throw new Error('El tiempo guardado no coincide con esta edición del examen.')
  }
  const questions = new Map(form.sections.flatMap(section => [...section.questions, ...section.reserves]).map(q => [q.id, q]))
  const answers = new Map(revision.answers)
  for (const [question, option] of answers) {
    if (!questions.get(question)?.options.some(value => value.id === option)) {
      throw new Error('La hoja guardada contiene una opción ajena a esta edición del examen.')
    }
  }
  return answers
}

export type ExamMark = 'correct' | 'incorrect' | 'blank' | 'annulled' | 'unused'

export function scoreExamSection(section: ExamSection, answers: Map<string, string>) {
  const cancelled = (q: ExamQuestion) => q.provenance.status === 'annulled'
  const substitutions = section.questions.filter(cancelled).length
  const countedReserves = new Set(section.reserves.filter(q => !cancelled(q)).slice(0, substitutions).map(q => q.id))
  let correct = 0, incorrect = 0, blank = 0
  const rows = [...section.questions, ...section.reserves].map((question, index) => {
    const reserve = index >= section.questions.length
    const selected = answers.get(question.id)
    let mark: ExamMark
    if (cancelled(question)) mark = 'annulled'
    else if (reserve && !countedReserves.has(question.id)) mark = 'unused'
    else if (!selected) { mark = 'blank'; blank++ }
    else if (question.options.find(o => o.id === selected)?.correct) { mark = 'correct'; correct++ }
    else { mark = 'incorrect'; incorrect++ }
    return { question, selected, mark, reserve, number: reserve ? index - section.questions.length + 1 : index + 1 }
  })
  return { correct, incorrect, blank, maximum: correct + incorrect + blank, thirds: 3 * correct - incorrect, rows }
}
