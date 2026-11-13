import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, ListChecks } from 'lucide-react'
import { Dialog } from '../components/Dialog'
import type { Activity, Attempt, GuidedSession, LabEvent, LabPackage, SessionPosition } from './model'
import { sessionAssistance, sessionMinutes } from './guided'
import { StudyText } from './StudyText'
import { StudyNoteEditor } from './StudyNoteEditor'
import { LearningReading } from './LearningReading'
import './assessment-ui.css'

export function GuidedSessionView({ pack, session, accountId, deviceId, events, record, openMaterial, renderActivity, initialPosition, onPosition, afterSession }: {
  pack: LabPackage; session: GuidedSession; accountId: string; deviceId: string; events: LabEvent[]
  record: (events: LabEvent[]) => Promise<void>
  openMaterial: (resourceId: string, sectionId: string) => void
  renderActivity: (activity: Activity, referenceVisible: boolean, afterAnswer: { label: string; run: () => void } | undefined, assessment: boolean) => ReactNode
  afterSession?: ReactNode
  initialPosition?: SessionPosition
  onPosition?: (position: SessionPosition) => void
}) {
  const [stageIndex, setStageIndex] = useState(() => Math.max(0, session.stages.findIndex(stage => stage.id === initialPosition?.stageId)))
  const stage = session.stages[stageIndex]
  const assessment = stage.kind === 'recover' || stage.kind === 'transfer'
  const [activityId, setActivityId] = useState<string | null>(() => initialPosition?.completed ? null
    : initialPosition?.activityId && stage.activityIds.includes(initialPosition.activityId) ? initialPosition.activityId : stage.activityIds[0] ?? null)
  const [completed, setCompleted] = useState(initialPosition?.completed ?? false)
  const [error, setError] = useState('')
  const [showStages, setShowStages] = useState(false)
  const [showActivities, setShowActivities] = useState(false)
  const content = useRef<HTMLElement>(null)
  const moveFocus = useRef(false)
  const navigation = useRef<Promise<void>>(Promise.resolve())
  const mounted = useRef(false)
  const event = (stageId: string, activityId: string | null, completed = false): SessionPosition => ({
    id: crypto.randomUUID(), kind: 'session-position', accountId, deviceId, createdAt: new Date().toISOString(),
    packageId: pack.id, packageVersion: pack.version, sessionId: session.id, sessionVersion: session.version,
    stageId, activityId, completed,
  })
  // Restoring a saved location is not new navigation. Refreshing its timestamp could
  // overwrite a later completion received from another device.
  const [arrival] = useState(() => initialPosition ? null : event(stage.id, activityId, completed))
  useEffect(() => {
    mounted.current = true
    let active = true
    if (arrival) navigation.current = record([arrival]).then(() => { if (active) onPosition?.(arrival) })
      .catch(failure => { if (active) setError(String(failure)) })
    return () => { active = false; mounted.current = false }
  }, [])
  useLayoutEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    content.current?.focus({ preventScroll: true })
    content.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [stageIndex, activityId, completed])
  function navigate(nextStage: number, nextActivity: string | null, finish = false) {
    navigation.current = navigation.current.then(async () => {
      if (!mounted.current) return
      try {
        const position = event(session.stages[nextStage].id, nextActivity, finish)
        await record([position])
        if (!mounted.current) return
        onPosition?.(position)
        moveFocus.current = true
        setStageIndex(nextStage); setActivityId(nextActivity); setCompleted(finish); setError('')
      } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'No se pudo guardar el punto de la sesión.') }
    })
    return navigation.current
  }
  const activity = pack.activities.find(activity => activity.id === activityId)
  const nextActivity = activity ? stage.activityIds[stage.activityIds.indexOf(activity.id) + 1] : undefined
  const nextStage = session.stages[stageIndex + 1]
  const continueStudy = nextActivity ? { label: 'Siguiente ejercicio', run: () => void navigate(stageIndex, nextActivity) }
    : nextStage ? { label: 'Continuar a ' + nextStage.title.toLocaleLowerCase('es'), run: () => void navigate(stageIndex + 1, nextStage.activityIds[0] ?? null) }
    : undefined
  const referenceVisible = !!activity && stage.readings.some(reading =>
    pack.lessons.find(lesson => lesson.id === reading.lessonId)?.objectiveIds.some(id => activity.objectiveIds.includes(id)))
  const allIds = session.stages.flatMap(stage => stage.activityIds)
  const attempts = events.filter((event): event is Attempt => event.kind === 'attempt' && event.accountId === accountId
    && event.packageId === pack.id && event.packageVersion === pack.version && allIds.includes(event.activityId)
    && pack.activities.some(activity => activity.id === event.activityId && activity.version === event.activityVersion))
  const answered = new Set(attempts.filter(attempt => attempt.outcome !== 'omitted').map(attempt => attempt.activityId))
  const helped = sessionAssistance(pack, session, events, accountId)
  const names = { correct: 'Correcta', incorrect: 'Por revisar', omitted: 'Sin respuesta', partial: 'Parcial, con campos sin responder' }
  const firstPendingStage = session.stages.findIndex(step => step.activityIds.some(id => !answered.has(id)))
  const firstPending = session.stages[firstPendingStage]?.activityIds.find(id => !answered.has(id))
  return <article className="lab-guided" aria-label="Sesión guiada">
    <header className="lab-lesson-heading">
      <h2 tabIndex={-1} data-study-heading>{session.title}</h2><p>{sessionMinutes(session)} min · {answered.size} de {allIds.length} actividades respondidas</p>
    </header>
    <nav className="lab-guided-overview" aria-label="Etapas de la sesión">
      <span>Etapa {stageIndex + 1} de {session.stages.length} · {stage.minutes} min orientativos</span>
      <button type="button" className="text-link" aria-haspopup="dialog" onClick={event => {
        event.currentTarget.focus({ preventScroll: true }); setShowStages(true)
      }}><ListChecks size={17} aria-hidden="true" /> Ver etapas</button>
    </nav>
    {showStages && <Dialog title="Etapas de la sesión" className="lab-guided-index" closeLabel="Volver a la sesión" showCloseLabel preserveScroll
      onClose={() => setShowStages(false)}>
      <ol className="lab-assessment-list">{session.stages.map((step, index) => <li key={step.id}>
        <button type="button" className="lab-assessment-row" aria-current={stageIndex === index ? 'step' : undefined}
          onClick={() => {
            setShowStages(false)
            if (stageIndex !== index) void navigate(index, step.activityIds[0] ?? null)
          }}>
          <span><strong>{index + 1}. {step.title}</strong><small>{step.minutes} min orientativos</small></span>
          {stageIndex === index && <Check size={18} aria-hidden="true" />}
        </button>
      </li>)}</ol>
    </Dialog>}
    {error && <p role="alert">{error}</p>}
    <section className="lab-guided-content" ref={content} tabIndex={-1} aria-labelledby="guided-stage-title">
      <h3 id="guided-stage-title">{stage.title}</h3><StudyText text={stage.instructions} />
      {stage.kind === 'recover' && <p className="lab-mode">Si es tu primera vez, úsalo como punto de partida. Una respuesta repetida conserva su historial.</p>}
      {stage.kind === 'transfer' && <p className="lab-mode">Variantes de práctica. Esta sesión conserva las reservas de evaluación.</p>}
      {stage.readings.map(reading => {
        const lesson = pack.lessons.find(lesson => lesson.id === reading.lessonId)!
        return <div key={reading.lessonId} className="lab-guided-reading">
          <LearningReading key={`${stage.id}:${lesson.id}`} pack={pack} lesson={lesson} accountId={accountId}
            deviceId={deviceId} events={events} record={record}>
          {reading.explanationIndexes.map(index => <section key={'explanation-' + index}><h4>{lesson.explanation[index].title}</h4><StudyText text={lesson.explanation[index].body} /></section>)}
          {reading.workedExampleIndexes.length > 0 && <div className="lab-example">{reading.workedExampleIndexes.map(index => <section key={'example-' + index}>
            <h4>{lesson.workedExample[index].title}</h4><StudyText text={lesson.workedExample[index].body} /></section>)}</div>}
          <button className="button lab-material-link" onClick={event => {
            event.currentTarget.focus({ preventScroll: true })
            openMaterial(lesson.material.resourceId, lesson.material.sectionId)
          }}>Consultar material completo: {lesson.title}</button>
          </LearningReading>
        </div>
      })}
      {stage.activityIds.length > 1 && <nav className="lab-guided-overview" aria-label="Actividades de esta etapa">
        <span>Actividad {stage.activityIds.indexOf(activityId ?? '') + 1} de {stage.activityIds.length}</span>
        <button type="button" className="text-link" aria-haspopup="dialog" onClick={event => {
          event.currentTarget.focus({ preventScroll: true }); setShowActivities(true)
        }}>Ver actividades</button>
      </nav>}
      {showActivities && <Dialog title="Actividades de esta etapa" className="lab-guided-index" closeLabel="Volver a la actividad" showCloseLabel preserveScroll
        onClose={() => setShowActivities(false)}>
        <ol className="lab-assessment-list">{stage.activityIds.map((id, index) => <li key={id}>
          <button type="button" className="lab-assessment-row" aria-current={activityId === id ? 'step' : undefined}
            onClick={() => {
              setShowActivities(false)
              if (activityId !== id) void navigate(stageIndex, id)
            }}>
            <span><strong>{assessment ? `Ejercicio ${index + 1}` : pack.activities.find(activity => activity.id === id)?.title}</strong>
              <small>{answered.has(id) ? 'Respondida' : 'Pendiente'}</small></span>
            {activityId === id && <Check size={18} aria-hidden="true" />}
          </button>
        </li>)}</ol>
      </Dialog>}
      {activity && <div className="lab-guided-practice">{renderActivity(activity, referenceVisible, continueStudy, assessment)}</div>}
      {stage.kind === 'close' && <section className="lab-guided-summary" aria-label="Respuestas guardadas">
        <h4>{answered.size} de {allIds.length} actividades con respuesta guardada</h4>
        {firstPending && <p>{allIds.length - answered.size} pendientes.
          {' '}<button className="text-link" type="button" onClick={() => void navigate(firstPendingStage, firstPending)}>
            Ir a la primera pendiente
          </button>
        </p>}
        <StudyNoteEditor target={{ kind: 'session', purpose: 'reflection', packageId: pack.id, packageVersion: pack.version,
          sessionId: session.id, sessionVersion: session.version }} accountId={accountId} deviceId={deviceId} events={events} record={record}
          label="Errores y próximo paso" />
        <details><summary>Revisar respuestas y ayudas</summary>{allIds.map(id => {
          const own = attempts.filter(attempt => attempt.activityId === id).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
          const first = own[0], last = own.at(-1)
          return <p key={id}><strong>{pack.activities.find(activity => activity.id === id)!.title}</strong><br />
            {first ? `Primera respuesta: ${names[first.outcome]}. Última: ${names[last!.outcome]}.` : 'Sin respuesta guardada.'}
            {helped.has(id) && ' Hay pistas o soluciones consultadas.'}</p>
        })}</details>
        {completed ? <><p role="status">Sesión cerrada. Tus respuestas y ayudas siguen guardadas.</p>{afterSession}</>
          : <button className="button primary" onClick={() => void navigate(stageIndex, null, true)}>Cerrar sesión de estudio</button>}
      </section>}
    </section>
    <nav className="lab-activity-navigation lab-guided-bottom" aria-label="Cambiar etapa">
      <button className="button" disabled={stageIndex === 0} onClick={() => void navigate(stageIndex - 1, session.stages[stageIndex - 1].activityIds[0] ?? null)}><ArrowLeft size={16} /> Etapa anterior</button>
      {stageIndex < session.stages.length - 1 && <button className="button primary" onClick={() => void navigate(stageIndex + 1, session.stages[stageIndex + 1].activityIds[0] ?? null)}>Siguiente etapa <ArrowRight size={16} /></button>}
    </nav>
  </article>
}
