import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ExamForm, ExamRevision, LabEvent, LabPackage } from './model'
import { examAnswers, examHeads, examRevisions, examRunReady, scoreExamSection, type ExamMark } from './exams'
import { exportHistory, mergeEvents } from './history'
import { RevisionWriteBuffer } from './revision-buffer'
import { StudyText } from './StudyText'

interface ExamContext {
  pack: LabPackage
  form: ExamForm
  accountId: string
  events: LabEvent[]
}
interface ExamViewProps extends ExamContext {
  deviceId: string
  record: (events: LabEvent[]) => Promise<void>
}

const buffers = new Map<string, RevisionWriteBuffer<ExamRevision>>()
function getBuffer({ accountId, pack, form }: ExamContext) {
  const key = JSON.stringify([accountId, pack.id, pack.version, form.id, form.version])
  let buffer = buffers.get(key)
  if (!buffer) {
    buffer = new RevisionWriteBuffer<ExamRevision>(() => {
      const warn = [...buffers.values()].some(buffer => buffer.hasUnsaved())
      if (warn) window.addEventListener('beforeunload', warnBeforeUnload)
      else window.removeEventListener('beforeunload', warnBeforeUnload)
    }, { collision: 'Hay otra revisión con la misma identidad. Descarga la copia pendiente.', failure: 'No se pudo guardar el examen.' })
    buffers.set(key, buffer)
  }
  return buffer
}
function warnBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault()
  event.returnValue = ''
}

export function ExamCatalog({ packages, events, accountId, open }: {
  packages: LabPackage[]; events: LabEvent[]; accountId: string; open: (pack: LabPackage, form: ExamForm) => void
}) {
  const forms = packages.flatMap(pack => (pack.exams ?? []).map(form => ({ pack, form })))
  if (!forms.length) return null
  return <section className="lab-guided-catalog" aria-label="Evaluaciones y exámenes">
    <h2>Evaluaciones y exámenes</h2>
    <div className="lab-lesson-list">{forms.map(({ pack, form }) => {
      const heads = examHeads(examRevisions(events, accountId, pack, form))
      return <button className="lab-lesson" key={JSON.stringify([pack.id, pack.version, form.id])} onClick={() => open(pack, form)}>
        <span><strong>{form.title}</strong>
          <small>{form.durationMinutes} min · {form.partition === 'reserved' ? 'Reservada' : 'Entrenamiento'}
            {heads.some(head => head.submitted === null) ? ' · En curso' : heads.length ? ' · Con resultados' : ''}</small></span>
      </button>
    })}</div>
  </section>
}

export function ExamView(props: ExamViewProps) {
  const { pack, form, accountId, deviceId, events, record } = props
  const buffer = getBuffer(props)
  const entries = useSyncExternalStore(buffer.subscribe, buffer.snapshot)
  useEffect(() => buffer.acknowledge(events), [buffer, events])
  const [selectedRun, setSelectedRun] = useState<string>()
  const [questionIndex, setQuestionIndex] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const questionHeading = useRef<HTMLLegendElement>(null)
  const focusNext = useRef(false)
  useLayoutEffect(() => {
    if (focusNext.current) questionHeading.current?.focus()
    focusNext.current = false
  }, [questionIndex])
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
  const runIds = [...state.runs.keys()].sort((a, b) => {
    const start = (id: string) => state.runs.get(id)![0].startedAt
    return Date.parse(start(b)) - Date.parse(start(a)) || a.localeCompare(b)
  })
  const runId = selectedRun ?? runIds.find(id => examHeads(state.runs.get(id)!).some(head => !head.submitted)) ?? runIds[0]
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
  const { answers, contentError } = useMemo(() => {
    try { return { answers: current ? examAnswers(form, current) : undefined, contentError: '' } }
    catch (error) { return { answers: undefined, contentError: String(error) } }
  }, [current, form])

  function save(previous: ExamRevision, next: ExamRevision['answers'], submit: boolean, parents = [previous]) {
    if (buffer.hasUnsaved()) return
    const latestParent = Math.max(...parents.map(parent => Date.parse(parent.createdAt)))
    const wall = Math.max(effectiveNow(), latestParent)
    const end = Date.parse(previous.deadlineAt)
    if (wall < Date.parse(previous.startedAt) - 60_000) return
    const expired = wall >= end
    const submitted = previous.submitted ?? (expired ? 'expired' : submit ? 'manual' : null)
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
    setNow(started); setSelectedRun(id); setQuestionIndex(0); setConfirm(false)
    void buffer.save({ kind: 'exam-revision', id, runId: id, accountId, deviceId, createdAt: startedAt, startedAt,
      deadlineAt: new Date(started + form.durationMinutes * 60_000).toISOString(), parentIds: [],
      packageId: pack.id, packageVersion: pack.version, examId: form.id, examVersion: form.version, answers: [], submitted: null }, record)
  }

  function downloadPending() {
    const url = URL.createObjectURL(new Blob([exportHistory(accountId, entries.map(entry => entry.note))], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'laboratorio-examen-pendiente.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const items = form.sections.flatMap(section => [...section.questions, ...section.reserves].map((question, index) => ({
    question, section, label: index < section.questions.length ? `Pregunta ${index + 1}` : `Reserva ${index - section.questions.length + 1}`,
  })))
  const reserveCount = form.sections.reduce((count, section) => count + section.reserves.length, 0)
  const item = items[questionIndex]
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000))
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const answerable = ready && current && !current.submitted && answers && !expires && !clockError && !state.error
  function move(index: number) {
    if (index === questionIndex) { questionHeading.current?.focus(); return }
    focusNext.current = true
    setQuestionIndex(index)
  }
  return <article className="lab-exam">
    <h2>{form.title}</h2>
    {runIds.length > 1 && <label>Intento guardado <select value={runId} onChange={event => {
      setSelectedRun(event.target.value); setQuestionIndex(0); setConfirm(false)
    }}>{runIds.map((id, index) => <option key={id} value={id}>Intento {runIds.length - index}</option>)}</select></label>}
    {state.error && <p role="alert">{state.error}</p>}
    {contentError && <p role="alert">{contentError}</p>}
    {clockError && <p role="alert">El reloj del dispositivo marca una hora anterior al inicio. Corrige la hora para continuar.</p>}
    {pending && <p role="status">Guardando hoja de respuestas…</p>}
    {failed.length > 0 && <div role="alert"><p>{failed[0].error}</p><div className="lab-actions">
      <button className="button" disabled={pending || failed.every(entry => entry.collision)} onClick={() => buffer.retry(record)}>Reintentar guardado</button>
      <button className="button" onClick={downloadPending}>Descargar hoja pendiente</button>
    </div></div>}
    {!runId && !state.error && <>
      <p>{items.length} preguntas{reserveCount > 0 ? `, con ${reserveCount} de reserva.` : '.'}
        {' '}Dispones de {form.durationMinutes} minutos desde el inicio. El reloj sigue al salir.</p>
      <p>Cada error descuenta un tercio.
        {reserveCount > 0 && ' Las reservas puntúan por orden si hay anulaciones en su parte.'}</p>
      {form.partition === 'reserved' && <p>La primera entrega queda guardada. Las repeticiones sirven para practicar.</p>}
      <button className="button primary" disabled={unsaved} onClick={start}>Empezar evaluación</button>
    </>}
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
    {answerable && <section aria-label="Hoja de respuestas">
      <div className="lab-exam-status">
        <p>{answers.size} de {items.length} respondidas</p>
        <p role="timer" aria-label="Tiempo restante">{time}</p>
      </div>
      <details><summary>Ir a una pregunta</summary><div className="lab-exam-jump">
        {items.map(({ question, label, section }, index) => <button key={question.id} className="button"
          aria-label={`${section.title}, ${label}, ${answers.has(question.id) ? 'respondida' : 'en blanco'}`}
          aria-current={index === questionIndex ? 'step' : undefined} onClick={() => move(index)}>{index + 1}</button>)}
      </div></details>
      <p>{item.section.title}</p>
      {item.section.scenario && <details><summary>Leer enunciado común</summary><StudyText text={item.section.scenario} /></details>}
      <fieldset aria-busy={pending}>
        <legend ref={questionHeading} tabIndex={-1}>{item.label}</legend>
        <StudyText text={item.question.prompt} />
        {item.question.options.map((option, index) => <label key={option.id} className="lab-option">
          <input type="radio" name="exam-choice" aria-disabled={unsaved} checked={answers.get(item.question.id) === option.id} onChange={() => {
            const next = new Map(answers); next.set(item.question.id, option.id)
            save(current, [...next], false)
          }} /><span>{String.fromCharCode(65 + index)}. {option.text}</span>
        </label>)}
        <button className="button" disabled={unsaved || !answers.has(item.question.id)} onClick={() => {
          const next = new Map(answers); next.delete(item.question.id); save(current, [...next], false)
        }}>Dejar en blanco</button>
      </fieldset>
      <div className="lab-actions">
        <button className="button" disabled={questionIndex === 0} onClick={() => move(questionIndex - 1)}>Anterior</button>
        <button className="button" disabled={questionIndex === items.length - 1} onClick={() => move(questionIndex + 1)}>Siguiente</button>
        <button className="button primary" disabled={unsaved} onClick={() => setConfirm(true)}>Entregar examen</button>
      </div>
      {confirm && <section aria-label="Confirmar entrega">
        <p>Quedan {items.length - answers.size} preguntas en blanco. Tras la entrega podrás ver la corrección.</p>
        <div className="lab-actions">
          <button className="button primary" disabled={unsaved} onClick={() => save(current, current.answers, true)}>Confirmar entrega</button>
          <button className="button" onClick={() => setConfirm(false)}>Seguir respondiendo</button>
        </div>
      </section>}
    </section>}
    {ready && current && !current.submitted && expires && <p role="status">Tiempo agotado. Se entrega la hoja guardada.</p>}
    {ready && current?.submitted && answers && !unsaved && !state.error && <>
      <h3>Resultado del examen</h3>
      <p>{current.submitted === 'expired' ? 'Entrega al agotar el tiempo.' : 'Entrega confirmada.'} Puntuación directa de práctica.</p>
      {form.sections.map((section, index) => <ExamResult key={index} section={section} answers={answers} sources={pack.sources} />)}
      {heads.length === 1 && !runIds.some(id => examHeads(state.runs.get(id)!).some(head => head.submitted === null))
        && <button className="button" onClick={start}>Repetir como práctica</button>}
    </>}
  </article>
}

const markLabels: Record<ExamMark, string> = {
  correct: 'Correcta', incorrect: 'Incorrecta', blank: 'En blanco', annulled: 'Anulada', unused: 'Reserva sin puntuar',
}
const scoreFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })
function ExamResult({ section, answers, sources }: {
  section: ExamForm['sections'][number]; answers: Map<string, string>; sources: LabPackage['sources']
}) {
  const result = scoreExamSection(section, answers)
  return <section>
    <h4>{section.title}</h4>
    <p>{scoreFormat.format(result.thirds / 3)} de {result.maximum} puntos · {result.correct} {result.correct === 1 ? 'acierto' : 'aciertos'}
      {' · '}{result.incorrect} {result.incorrect === 1 ? 'error' : 'errores'} · {result.blank} en blanco</p>
    {section.scenario && <details><summary>Leer enunciado común</summary><StudyText text={section.scenario} /></details>}
    {result.rows.map(({ question, selected, mark, reserve, number }) => <details key={question.id} className="lab-exam-correction">
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
