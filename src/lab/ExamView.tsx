import { memo, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, ListChecks } from 'lucide-react'
import { Dialog } from '../components/Dialog'
import type { ExamForm, ExamRevision, LabEvent, LabPackage } from './model'
import { examAnswers, examHeads, examRevisions, examRunReady, scoreExamSection, type ExamMark } from './exams'
import { exportHistory, mergeEvents } from './history'
import { RevisionWriteBuffer } from './revision-buffer'
import { StudyText } from './StudyText'
import { isBasicTechnologyTopic, labBlocks, labTopics } from './study-scope'
import './assessment-ui.css'

interface ExamContext {
  pack: LabPackage
  form: ExamForm
  accountId: string
  events: LabEvent[]
}
interface ExamViewProps extends ExamContext {
  deviceId: string
  record: (events: LabEvent[]) => Promise<void>
  initialRun?: string
  onRunChange?: (runId: string) => void
}

const buffers = new Map<string, RevisionWriteBuffer<ExamRevision>>()
function updateUnloadWarning() {
  if ([...buffers.values()].some(buffer => buffer.hasUnsaved())) window.addEventListener('beforeunload', warnBeforeUnload)
  else window.removeEventListener('beforeunload', warnBeforeUnload)
}
export function clearExamBuffers(accountId: string) {
  for (const key of buffers.keys()) if (JSON.parse(key)[0] === accountId) buffers.delete(key)
  updateUnloadWarning()
}
function getBuffer({ accountId, pack, form }: ExamContext) {
  const key = JSON.stringify([accountId, pack.id, pack.version, form.id, form.version])
  let buffer = buffers.get(key)
  if (!buffer) {
    buffer = new RevisionWriteBuffer<ExamRevision>(updateUnloadWarning,
      { collision: 'Hay otra revisión con la misma identidad. Descarga la copia pendiente.', failure: 'No se pudo guardar el examen.' })
    buffers.set(key, buffer)
  }
  return buffer
}
function warnBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault()
  event.returnValue = ''
}

const examLabels: Record<ExamForm['kind'], string> = {
  topic: 'Test de tema', 'case-iii': 'Supuesto práctico', 'full-iii': 'Simulacro',
}

export function ExamCatalog({ packages, events, accountId, open, topicId, mode }: {
  packages: LabPackage[]; events: LabEvent[]; accountId: string; open: (pack: LabPackage, form: ExamForm, runId?: string) => void
  topicId?: string; mode?: 'exams'
}) {
  const [kind, setKind] = useState<ExamForm['kind'] | ''>('')
  const [block, setBlock] = useState('')
  const [topic, setTopic] = useState('')
  const [onlyResults, setOnlyResults] = useState(false)
  const forms = useMemo(() => {
    const byEdition = new Map<string, ExamRevision[]>()
    for (const event of events) if (event.kind === 'exam-revision' && event.accountId === accountId) {
      const key = JSON.stringify([event.packageId, event.packageVersion, event.examId, event.examVersion])
      const saved = byEdition.get(key) ?? []
      saved.push(event)
      byEdition.set(key, saved)
    }
    const editions = new Map<string, { pack: LabPackage; form: ExamForm }[]>()
    for (const pack of packages) for (const form of pack.exams ?? []) {
      const key = JSON.stringify([pack.id, form.id])
      const entries = editions.get(key) ?? []
      entries.push({ pack, form })
      editions.set(key, entries)
    }
    return [...editions.values()].flatMap(entries => {
      entries.sort((a, b) => b.pack.version.localeCompare(a.pack.version, 'en', { numeric: true }) || b.pack.version.localeCompare(a.pack.version))
      return entries.flatMap(({ pack, form }, index) => {
        const key = JSON.stringify([pack.id, pack.version, form.id, form.version])
        const heads = examHeads(byEdition.get(key) ?? [])
        if (index > 0 && heads.length === 0) return []
        const objectiveIds = new Set(form.sections.flatMap(section =>
          [...section.questions, ...section.reserves].flatMap(question => question.objectiveIds)))
        const topics = new Set(pack.objectives.filter(objective => objectiveIds.has(objective.id)).map(objective => objective.topicId))
        const recentHeads = heads.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.runId.localeCompare(b.runId))
        return [{ pack, form, key, topics, previous: index > 0, active: recentHeads.find(head => !head.submitted)?.runId,
          result: recentHeads.find(head => !!head.submitted)?.runId }]
      })
    }).sort((a, b) => Number([...b.topics].some(isBasicTechnologyTopic)) - Number([...a.topics].some(isBasicTechnologyTopic)))
  }, [packages, events, accountId])
  const localForms = topicId ? forms.filter(entry => entry.form.kind === 'topic' && entry.topics.has(topicId)) : forms
  if (!localForms.length && mode !== 'exams') return null
  const fullCatalog = mode === 'exams' && !topicId
  const availableTopics = labTopics.filter(item => (!block || item.block === block) && forms.some(entry => entry.topics.has(item.id)))
  const active = localForms.filter(entry => entry.active)
  const catalog = fullCatalog ? localForms.filter(entry => {
    if (onlyResults ? !entry.result : entry.active) return false
    if (kind && entry.form.kind !== kind) return false
    if (topic && !entry.topics.has(topic)) return false
    return !block || [...entry.topics].some(id => id.startsWith(block + '.'))
      || (block === 'III' && entry.form.kind !== 'topic')
  }) : localForms
  const renderForm = ({ pack, form, key, previous, active, result }: typeof forms[number]) =>
    <li key={key}>
      <button type="button" className="lab-assessment-row" onClick={() => open(pack, form, onlyResults ? result : active || result)}>
        <span><strong>{form.title}</strong>
          <small>{examLabels[form.kind]} · {form.durationMinutes} min · {form.partition === 'reserved' ? 'Reservada' : 'Entrenamiento'}
            {previous && ' · Edición anterior'}</small>
          {active && !onlyResults ? <small className="lab-assessment-resume">Reanudar examen</small> : result && <small>Ver resultados</small>}
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </li>
  const heading = topicId ? 'Tests del tema' : 'Evaluaciones y exámenes'
  return <section className="lab-assessment-catalog" aria-label={heading}>
    {!fullCatalog && <h2>{heading}</h2>}
    {fullCatalog && !onlyResults && active.length > 0 && <section aria-label="Exámenes en curso" className="lab-assessment-in-progress">
      <h3>En curso</h3>
      <ul className="lab-assessment-list">{active.map(renderForm)}</ul>
      </section>}
    {fullCatalog && forms.length > 0 && <div className="lab-assessment-filters">
      <label>Tipo<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
        <option value="">Todos los tipos</option>
        {Object.entries(examLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Bloque<select value={block} onChange={event => { setBlock(event.target.value); setTopic('') }}>
        <option value="">Todos los bloques</option>
        {labBlocks.map(item => <option key={item.roman} value={item.roman}>{item.roman} · {item.title}</option>)}
      </select></label>
      <label>Tema<select value={topic} onChange={event => setTopic(event.target.value)}>
        <option value="">Todos los temas</option>
        {availableTopics.map(item => <option key={item.id} value={item.id}>{item.id} · {item.title}</option>)}
      </select></label>
      <label className="lab-assessment-results-filter"><input type="checkbox" checked={onlyResults}
        onChange={event => setOnlyResults(event.target.checked)} /> Con resultados</label>
    </div>}
    {catalog.length > 0 ? <ul className="lab-assessment-list">{catalog.map(renderForm)}</ul>
      : <p className="lab-assessment-empty" role="status">{localForms.length === 0 ? 'No hay exámenes disponibles en este catálogo.'
        : active.length === localForms.length && !onlyResults ? 'Todas las evaluaciones disponibles están en curso.'
          : 'No hay evaluaciones con estos filtros.'}</p>}
  </section>
}

export function ExamView(props: ExamViewProps) {
  const { pack, form, accountId, deviceId, events, record, onRunChange } = props
  const buffer = getBuffer(props)
  const entries = useSyncExternalStore(buffer.subscribe, buffer.snapshot)
  useEffect(() => buffer.acknowledge(events), [buffer, events])
  const [selectedRun, setSelectedRun] = useState(props.initialRun)
  const [questionLocation, setQuestionLocation] = useState<{ runId: string; index: number }>()
  const [confirm, setConfirm] = useState(false)
  const [showSheet, setShowSheet] = useState(false)
  const [showCase, setShowCase] = useState(false)
  const caseReading = useRef<HTMLDivElement>(null)
  const casePositions = useRef(new Map<string, number>())
  const answerSheet = useRef<HTMLElement>(null)
  const questionHeading = useRef<HTMLLegendElement>(null)
  const confirmation = useRef<HTMLElement>(null)
  const deliverButton = useRef<HTMLButtonElement>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const focusAfterRender = useRef<RefObject<HTMLElement | null> | null>(null)
  useLayoutEffect(() => {
    const target = focusAfterRender.current?.current
    if (target) {
      focusAfterRender.current = null
      target.focus()
    }
  })
  const clock = useRef({ wall: Date.now(), monotonic: performance.now() })
  const effectiveNow = () => Math.max(Date.now(), clock.current.wall + Math.floor(performance.now() - clock.current.monotonic))
  const [now, setNow] = useState(() => Date.now())
  const state = useMemo(() => {
    try {
      const revisions = examRevisions(mergeEvents(accountId, events, entries.map(entry => entry.note)), accountId, pack, form)
      const runs = new Map<string, ExamRevision[]>()
      for (const revision of revisions) {
        const run = runs.get(revision.runId) ?? []
        run.push(revision)
        runs.set(revision.runId, run)
      }
      return { runs, error: '' }
    } catch (error) { return { runs: new Map<string, ExamRevision[]>(), error: String(error) } }
  }, [accountId, events, entries, pack, form])
  const runIds = useMemo(() => [...state.runs.keys()].sort((a, b) => {
    const start = (id: string) => state.runs.get(id)![0].startedAt
    return Date.parse(start(b)) - Date.parse(start(a)) || a.localeCompare(b)
  }), [state.runs])
  const runId = selectedRun && state.runs.has(selectedRun) ? selectedRun
    : runIds.find(id => examHeads(state.runs.get(id)!).some(head => !head.submitted)) ?? runIds[0]
  const revisions = runId ? state.runs.get(runId) ?? [] : []
  const heads = examHeads(revisions)
  const current = heads.length === 1 ? heads[0] : undefined
  const ready = !!runId && examRunReady(revisions, runId)
  const pending = entries.some(entry => entry.status === 'pending')
  const failed = entries.filter(entry => entry.status === 'failed')
  const unsaved = pending || failed.length > 0
  const deadline = current ? Date.parse(current.deadlineAt) : 0
  const expires = !!current && now >= deadline
  const clockError = !!current && now < Date.parse(current.startedAt) - 60_000
  const activeRun = current && !current.submitted ? current.runId : undefined
  const { answers, contentError } = useMemo(() => {
    try { return { answers: current ? examAnswers(form, current) : undefined, contentError: '' } }
    catch (error) { return { answers: undefined, contentError: String(error) } }
  }, [current, form])

  function save(previous: ExamRevision, next: ExamRevision['answers'], submit: boolean, parents = [previous]) {
    if (buffer.snapshot().some(entry => entry.status === 'failed') || (submit && buffer.hasUnsaved())) return
    const latestParent = Math.max(...parents.map(parent => Date.parse(parent.createdAt)))
    const wall = Math.max(effectiveNow(), latestParent)
    const end = Date.parse(previous.deadlineAt)
    if (wall < Date.parse(previous.startedAt) - 60_000) return
    const expired = wall >= end
    const submitted = previous.submitted ?? (expired ? 'expired' : submit ? 'manual' : null)
    if (submit || (expired && (showCase || showSheet || answerSheet.current?.contains(document.activeElement)))) {
      focusAfterRender.current = resultHeading
    }
    void buffer.save({ ...previous, id: crypto.randomUUID(), deviceId, parentIds: parents.map(parent => parent.id),
      createdAt: new Date(expired ? Math.max(end, wall) : wall).toISOString(), submitted,
      answers: submitted ? previous.answers : next }, record)
    setConfirm(false)
  }

  const tick = useEffectEvent(() => {
    const time = effectiveNow()
    setNow(time)
    if (current && !current.submitted && time >= deadline) save(current, current.answers, false)
  })
  useEffect(() => {
    if (!ready || !current || current.submitted || contentError) return
    const update = () => tick()
    update()
    const interval = window.setInterval(update, 1000)
    window.addEventListener('focus', update)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', update) }
  }, [ready, current?.id, current?.submitted, deadline, contentError])

  function start() {
    if (buffer.hasUnsaved()) return
    const id = crypto.randomUUID()
    const started = Date.now()
    const startedAt = new Date(started).toISOString()
    clock.current = { wall: started, monotonic: performance.now() }
    focusAfterRender.current = questionHeading
    setNow(started); setSelectedRun(id); setQuestionLocation({ runId: id, index: 0 }); setConfirm(false)
    void buffer.save({ kind: 'exam-revision', id, runId: id, accountId, deviceId, createdAt: startedAt, startedAt,
      deadlineAt: new Date(started + form.durationMinutes * 60_000).toISOString(), parentIds: [],
      packageId: pack.id, packageVersion: pack.version, examId: form.id, examVersion: form.version, answers: [], submitted: null }, record)
      .then(saved => { if (saved) onRunChange?.(id) })
  }

  function downloadPending() {
    const url = URL.createObjectURL(new Blob([exportHistory(accountId, entries.map(entry => entry.note))], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'laboratorio-examen-pendiente.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const items = useMemo(() => form.sections.flatMap(section => [...section.questions, ...section.reserves].map((question, index) => ({
    question, section, label: index < section.questions.length ? `Pregunta ${index + 1}` : `Reserva ${index - section.questions.length + 1}`,
  }))), [form])
  const reserveCount = form.sections.reduce((count, section) => count + section.reserves.length, 0)
  const locationKey = JSON.stringify(['tai-lab-exam-question', accountId, pack.id, pack.version, form.id, form.version, runId])
  const questionIndex = useMemo(() => {
    if (questionLocation && questionLocation.runId === runId) return questionLocation.index
    try {
      const index = Number(sessionStorage.getItem(locationKey))
      return Number.isInteger(index) && index >= 0 && index < items.length ? index : 0
    } catch { return 0 }
  }, [runId, questionLocation, locationKey, items.length])
  const item = items[questionIndex]
  const caseKey = JSON.stringify([runId, form.sections.indexOf(item.section)])
  useLayoutEffect(() => {
    if (showCase && caseReading.current) caseReading.current.scrollTop = casePositions.current.get(caseKey) ?? 0
  }, [showCase, caseKey])
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000))
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const answerable = ready && current && !current.submitted && answers && !expires && !clockError && !state.error
  const move = useCallback((index: number) => {
    if (!runId) return
    focusAfterRender.current = questionHeading
    setConfirm(false)
    setShowSheet(false)
    setShowCase(false)
    setQuestionLocation({ runId, index })
    try { sessionStorage.setItem(locationKey, String(index)) } catch { /* Restore position when browser storage is available. */ }
  }, [runId, locationKey])
  function closeCase() {
    if (caseReading.current) casePositions.current.set(caseKey, caseReading.current.scrollTop)
    setShowCase(false)
  }
  useEffect(() => {
    setShowCase(false)
    setShowSheet(false)
    setConfirm(false)
  }, [activeRun])
  return <article className="lab-exam">
    <header className="lab-exam-heading">
      <p className="lab-exam-kind">{examLabels[form.kind]}</p>
      <h2 tabIndex={-1} data-study-heading>{form.title}</h2>
    </header>
    {runIds.length > 1 && <label>Intento guardado <select value={runId} onChange={event => {
      focusAfterRender.current = null
      setSelectedRun(event.target.value); setConfirm(false); setShowCase(false); setShowSheet(false)
      onRunChange?.(event.target.value)
    }}>{runIds.map((id, index) => <option key={id} value={id}>Intento {runIds.length - index}</option>)}</select></label>}
    {state.error && <p role="alert">{state.error}</p>}
    {contentError && <p role="alert">{contentError}</p>}
    {clockError && <p role="alert">El reloj del dispositivo marca una hora anterior al inicio. Corrige la hora para continuar.</p>}
    {failed.length > 0 && <div role="alert"><p>{failed[0].error}</p><div className="lab-actions">
      <button className="button" disabled={pending || failed.every(entry => entry.collision)} onClick={() => buffer.retry(record)}>Reintentar guardado</button>
      <button className="button" onClick={downloadPending}>Descargar hoja pendiente</button>
    </div></div>}
    {!runId && !state.error && <section className="lab-exam-intro" aria-label="Antes de empezar">
      <dl className="lab-exam-metrics">
        <div><dt>Duración</dt><dd>{form.durationMinutes} min</dd></div>
        <div><dt>Preguntas</dt><dd>{items.length - reserveCount}</dd></div>
        {reserveCount > 0 && <div><dt>Reservas</dt><dd>{reserveCount}</dd></div>}
      </dl>
      <p>{items.length} preguntas{reserveCount > 0 ? `, con ${reserveCount} de reserva.` : '.'}
        {' '}Dispones de {form.durationMinutes} minutos desde el inicio. El reloj sigue al salir.</p>
      {form.sections.length > 1 && <ul className="lab-exam-parts">{form.sections.map((section, index) =>
        <li key={index}>{section.title} · {section.questions.length} preguntas{section.reserves.length > 0 && ` + ${section.reserves.length} reservas`}</li>)}</ul>}
      <p>Cada error descuenta un tercio.
        {reserveCount > 0 && ' Las reservas puntúan por orden si hay anulaciones en su parte.'}</p>
      {form.partition === 'reserved' && <p>La primera entrega queda guardada. Las repeticiones sirven para practicar.</p>}
      <button className="button primary" disabled={unsaved} onClick={start}>Empezar evaluación</button>
    </section>}
    {runId && !ready && !unsaved && !state.error && <p role="status">Faltan revisiones del intento. Sincroniza o restaura su historial para continuar.</p>}
    {ready && heads.length > 1 && <section aria-label="Revisiones en conflicto">
      <h3>Hay hojas distintas para este intento</h3>
      <p>Elige la hoja que quieres conservar como resultado. Las revisiones anteriores quedan guardadas.</p>
      {heads.map((head, index) => <div key={head.id} className="lab-note-version">
        <p>Hoja {index + 1} · {head.answers.length} respuestas · {head.submitted ? 'Entregada' : 'En curso'}</p>
        <details><summary>Ver hoja {index + 1}</summary><ul>{items.map((entry, i) => {
          const selected = head.answers.find(([id]) => id === entry.question.id)?.[1]
          const position = entry.question.options.findIndex(option => option.id === selected)
          return <li key={entry.question.id}>{i + 1}. {position < 0 ? 'En blanco' : String.fromCharCode(65 + position)}</li>
        })}</ul></details>
        <button className="button" disabled={unsaved || (!head.submitted && heads.some(other => other.submitted))}
          onClick={() => save(head, head.answers, false, heads)}>Conservar hoja {index + 1}</button>
      </div>)}
    </section>}
    {answerable && <section ref={answerSheet} aria-label="Hoja de respuestas" className="lab-exam-active">
      <div className="lab-exam-status">
        <div><span>Preguntas</span><strong>{answers.size} de {items.length} respondidas</strong></div>
        <div><span>Tiempo restante</span><strong role="timer" aria-label="Tiempo restante">{time}</strong></div>
        <span className="lab-exam-save" role="status">{failed.length ? 'Revisa el guardado' : pending ? 'Guardando…' : 'Hoja guardada'}</span>
      </div>
      {confirm ? <section className="lab-exam-review" ref={confirmation} tabIndex={-1} aria-label="Confirmar entrega">
        <h3>Revisar entrega</h3>
        <p>Quedan {items.length - answers.size} preguntas en blanco. Tras la entrega podrás ver la corrección.</p>
        <ExamQuestionList form={form} answers={answers} current={questionIndex} move={move} blanksOnly />
        <div className="lab-actions">
          <button className="button primary" disabled={unsaved} onClick={() => save(current, current.answers, true)}>Confirmar entrega</button>
          <button className="button" onClick={() => {
            focusAfterRender.current = deliverButton
            setConfirm(false)
          }}>Seguir respondiendo</button>
        </div>
      </section> : <div className="lab-exam-task">
        <div className="lab-exam-sheet-trigger">
          <button className="text-link" type="button" aria-haspopup="dialog" onClick={event => {
            event.currentTarget.focus({ preventScroll: true }); setShowSheet(true)
          }}><ListChecks size={17} aria-hidden="true" /> Ir a una pregunta</button>
        </div>
        {showSheet && <Dialog title="Hoja de preguntas" className="lab-exam-sheet-dialog" closeLabel="Volver a la pregunta" showCloseLabel preserveScroll
          onClose={() => setShowSheet(false)}>
          <ExamQuestionList form={form} answers={answers} current={questionIndex} move={move} />
        </Dialog>}
        <section className="lab-exam-question">
          <div className="lab-exam-question-context"><span>{item.section.title}</span>
            {item.section.scenario && <button className="text-link" type="button" aria-haspopup="dialog"
              onClick={event => { event.currentTarget.focus({ preventScroll: true }); setShowCase(true) }}>
              <BookOpen size={17} aria-hidden="true" /> Ver caso
            </button>}</div>
          {showCase && item.section.scenario && <Dialog title={`Caso · ${item.section.title}`} className="lab-exam-case"
            closeLabel="Volver a la pregunta" showCloseLabel onClose={closeCase} preserveScroll wide>
            <div ref={caseReading} className="lab-exam-case-reading" role="region" aria-label="Enunciado común" tabIndex={0}>
              <StudyText text={item.section.scenario} />
            </div>
          </Dialog>}
          <fieldset>
            <legend ref={questionHeading} tabIndex={-1}>{item.label}</legend>
            <StudyText text={item.question.prompt} />
            {item.question.options.map((option, index) => <label key={option.id} className="lab-option">
              <input type="radio" name="exam-choice" aria-disabled={failed.length > 0} checked={answers.get(item.question.id) === option.id} onChange={() => {
                const next = new Map(answers); next.set(item.question.id, option.id)
                save(current, [...next], false)
              }} /><span>{String.fromCharCode(65 + index)}. {option.text}</span>
            </label>)}
            <button className="button" aria-disabled={failed.length > 0 || !answers.has(item.question.id)} onClick={() => {
              if (!answers.has(item.question.id)) return
              const next = new Map(answers); next.delete(item.question.id); save(current, [...next], false)
            }}>Dejar en blanco</button>
          </fieldset>
          <div className="lab-actions lab-exam-actions">
            <button className="button" disabled={questionIndex === 0} onClick={() => move(questionIndex - 1)}><ArrowLeft size={16} aria-hidden="true" /> Anterior</button>
            <button className="button" disabled={questionIndex === items.length - 1} onClick={() => move(questionIndex + 1)}>Siguiente <ArrowRight size={16} aria-hidden="true" /></button>
            <button ref={deliverButton} className="button primary" disabled={unsaved} onClick={() => {
              focusAfterRender.current = confirmation
              setConfirm(true)
            }}>Revisar entrega</button>
          </div>
        </section>
      </div>}
      {!confirm && !showSheet && <aside className="lab-exam-sidebar" aria-label="Hoja de preguntas">
        <ExamQuestionList form={form} answers={answers} current={questionIndex} move={move} />
      </aside>}
    </section>}
    {ready && current && !current.submitted && expires && <p role="status">Tiempo agotado. Se entrega la hoja guardada.</p>}
    {ready && current?.submitted && answers && !unsaved && !state.error && <>
      <h3 ref={resultHeading} tabIndex={-1}>Resultado del examen</h3>
      <p>{current.submitted === 'expired' ? 'Entrega al agotar el tiempo.' : 'Entrega confirmada.'} Puntuación directa de práctica.</p>
      {form.sections.map((section, index) => <ExamResult key={index} section={section} answers={answers} sources={pack.sources} />)}
      {heads.length === 1 && !runIds.some(id => examHeads(state.runs.get(id)!).some(head => head.submitted === null))
        && <button className="button" onClick={start}>Repetir como práctica</button>}
    </>}
  </article>
}

const ExamQuestionList = memo(function ExamQuestionList({ form, answers, current, move, blanksOnly = false }: {
  form: ExamForm; answers: Map<string, string>; current: number; move: (index: number) => void; blanksOnly?: boolean
}) {
  let offset = 0
  return <div className="lab-exam-question-list">{form.sections.map((section, index) => {
    const groupStart = offset
    offset += section.questions.length + section.reserves.length
    const groups = [
      { label: 'Preguntas', items: section.questions, start: groupStart, reserve: false },
      { label: 'Reservas', items: section.reserves, start: groupStart + section.questions.length, reserve: true },
    ]
    const renderGroup = ({ label, items, start, reserve }: typeof groups[number]) => {
      if (!items.length) return null
      const visible = items.flatMap((question, position) => {
        const answered = answers.has(question.id)
        if (blanksOnly && answered) return []
        const questionLabel = `${reserve ? 'Reserva' : 'Pregunta'} ${position + 1}`
        const active = current === start + position
        return <button key={question.id} type="button" className="button" data-answered={answered}
          aria-label={`${section.title}, ${questionLabel}, ${answered ? 'respondida' : 'en blanco'}`}
          aria-current={active ? 'step' : undefined} onClick={() => move(start + position)}>
          {reserve ? `R${position + 1}` : position + 1}{answered && <Check size={13} aria-hidden="true" />}
        </button>
      })
      return <div key={label} className="lab-exam-question-group">
        <p>{label}{blanksOnly && ` en blanco · ${visible.length}`}</p>
        {visible.length > 0 && <div className="lab-exam-jump">{visible}</div>}
      </div>
    }
    return <section key={index} aria-label={section.title} className="lab-exam-part">
      <h4>{section.title}</h4>{groups.map(renderGroup)}
    </section>
  })}</div>
})

const markLabels: Record<ExamMark, string> = {
  correct: 'Correcta', incorrect: 'Incorrecta', blank: 'En blanco', annulled: 'Anulada', unused: 'Reserva sin puntuar',
}
const scoreFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })
function ExamResult({ section, answers, sources }: {
  section: ExamForm['sections'][number]; answers: Map<string, string>; sources: LabPackage['sources']
}) {
  const result = scoreExamSection(section, answers)
  const annulled = result.rows.filter(row => row.mark === 'annulled').length
  const countedReserves = result.rows.filter(row => row.reserve && row.mark !== 'unused' && row.mark !== 'annulled')
  const needsReview = (row: typeof result.rows[number]) => row.mark === 'incorrect' || row.mark === 'blank'
  const rows = [...result.rows].sort((a, b) => Number(needsReview(b)) - Number(needsReview(a)))
  return <section className="lab-exam-result-part">
    <h4>{section.title}</h4>
    <p className="lab-exam-score">{scoreFormat.format(result.thirds / 3)} de {result.maximum} puntos · {result.correct} {result.correct === 1 ? 'acierto' : 'aciertos'}
      {' · '}{result.incorrect} {result.incorrect === 1 ? 'error' : 'errores'} · {result.blank} en blanco</p>
    {(annulled > 0 || section.reserves.length > 0) && <p className="lab-exam-scoring-note">{annulled} {annulled === 1 ? 'anulada' : 'anuladas'}
      {section.reserves.length > 0 && (countedReserves.length > 0
        ? ` · Reservas aplicadas: ${countedReserves.map(row => `R${row.number}`).join(', ')}` : ' · Sin reservas aplicadas')}</p>}
    {section.scenario && <details className="lab-exam-result-case"><summary>Ver caso</summary><StudyText text={section.scenario} /></details>}
    {rows.map(({ question, selected, mark, reserve, number }) => <details key={question.id} className="lab-exam-correction" data-mark={mark}>
      <summary>{reserve ? 'Reserva' : 'Pregunta'} {number} · {markLabels[mark]}</summary>
      <StudyText text={question.prompt} />
      <ul>{question.options.map(option => <li key={option.id}>
        <StudyText text={option.text} />
        {option.id === selected && <strong> Tu respuesta.</strong>}{option.correct && <strong>{question.provenance.kind === 'official-tai' ? ' Clave oficial.' : ' Opción correcta.'}</strong>}
        <StudyText text={option.explanation} />
      </li>)}</ul>
      <ul aria-label="Referencias para la corrección">{question.claims.map((claim, index) => {
        const source = sources.find(source => source.id === claim.sourceId)
        return <li key={index}>{source && <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>} · {claim.locator}</li>
      })}</ul>
    </details>)}
  </section>
}
