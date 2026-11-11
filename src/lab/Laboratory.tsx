import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Check, Download, RefreshCw } from 'lucide-react'
import type { DriveLibrary } from '../drive/library'
import { blocks } from '../syllabus'
import type { Activity, Attempt, Draft, LabEvent, LabPackage, Lesson, SessionPosition, SqlActivity } from './model'
import { compareSqlRows } from './sql-comparison'
import type { SqlResult } from './sql-runner'
import { LabSync, type LabSnapshot } from './sync'
import { browserHistoryStore } from './store'
import { labTransport } from './drive'
import { cachePackage, cachedPackages } from './content-store'
import { assistanceFor, gradeChoice } from './grading'
import { draftHeads, exportHistory, mergeEvents, restoreHistory } from './history'
import { draftWriteBuffer } from './draft-buffer'
import { ActiveTime } from './active-time'
import { OfflineControls } from './OfflineControls'
import { CodePanel } from './CodePanel'
import { HtmlPanel } from './HtmlPanel'
import { StudyText } from './StudyText'
import { activityLocationKey, studyContinuation } from './continuation'
import { LessonCatalog } from './LessonCatalog'
import { GuidedSessionView } from './GuidedSessionView'
import { sessionMinutes, sessionResume } from './guided'
import { StudyNoteEditor } from './StudyNoteEditor'
import './laboratory.css'

const empty: LabSnapshot = { events: [], pendingIds: [], status: 'local' }
const idle = () => () => {}
const statusText = { local: 'Guardado en este dispositivo', pending: 'Pendiente de sincronizar', syncing: 'Sincronizando', synced: 'Sincronizado', error: 'Revisa el guardado o la conexión' }
const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.'
const packageKey = (pack: LabPackage) => JSON.stringify([pack.id, pack.version])
const narrowQuery = '(max-width: 800px)'
const subscribeWidth = (changed: () => void) => {
  const query = matchMedia(narrowQuery); query.addEventListener('change', changed)
  return () => query.removeEventListener('change', changed)
}
function deviceIdentity() {
  const key = 'tai-hub.lab.device'
  try {
    const existing = localStorage.getItem(key)
    if (existing) return existing
    const id = crypto.randomUUID(); localStorage.setItem(key, id); return id
  } catch { return crypto.randomUUID() }
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('La copia no contiene texto.'))
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer la copia local.'))
    reader.readAsText(file)
  })
}

export default function Laboratory({ library, accountId, connected, openMaterial }: {
  library: DriveLibrary; accountId?: string; connected: boolean; openMaterial: (resourceId: string, sectionId: string) => void
}) {
  return <section className="laboratory" aria-label="Laboratorio TAI">
    <div className="page-heading"><p className="context-label">Bloques III y IV</p><h1>Laboratorio TAI</h1>
      <p>Lecciones, práctica y evaluaciones de III y IV.</p></div>
    {accountId ? <Workspace key={accountId} library={library} accountId={accountId} connected={connected} openMaterial={openMaterial} />
      : <p>Conecta tu biblioteca de Google Drive para cargar tus lecciones y tu progreso privado.</p>}
  </section>
}

function Workspace({ library, accountId, connected, openMaterial }: {
  library: DriveLibrary; accountId: string; connected: boolean; openMaterial: (resourceId: string, sectionId: string) => void
}) {
  const [sync, setSync] = useState<LabSync>()
  const history = useSyncExternalStore(sync?.subscribe ?? idle, sync?.snapshot ?? (() => empty))
  const [deviceId] = useState(deviceIdentity)
  const [packages, setPackages] = useState<LabPackage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<{ pack: string; lesson?: string; activity?: string; session?: string; positionId?: string } | undefined>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem('tai-lab-location:' + accountId) ?? 'null')
      if (typeof value?.pack === 'string' && typeof value?.lesson === 'string') return {
        pack: value.pack, lesson: value.lesson, activity: typeof value.activity === 'string' ? value.activity : undefined,
      }
      if (typeof value?.pack === 'string' && typeof value?.session === 'string') return {
        pack: value.pack, session: value.session, positionId: typeof value.positionId === 'string' ? value.positionId : undefined,
      }
    } catch { /* A missing location does not affect the durable event history. */ }
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const currentPackage = packages.find(p => packageKey(p) === selected?.pack)
  const currentLesson = currentPackage?.lessons.find(l => l.id === selected?.lesson)
  const currentSession = currentPackage?.sessions?.find(session => session.id === selected?.session)
  const sessionPosition = history.events.find((event): event is SessionPosition => event.kind === 'session-position'
    && event.id === selected?.positionId && event.accountId === accountId && event.packageId === currentPackage?.id
    && event.packageVersion === currentPackage?.version && event.sessionId === currentSession?.id && event.sessionVersion === currentSession?.version)
  const continuation = useMemo(() => studyContinuation(packages, history.events, accountId), [packages, history.events, accountId])
  const guidedContinuation = useMemo(() => sessionResume(packages, history.events, accountId), [packages, history.events, accountId])
  useEffect(() => {
    try {
      if (selected) sessionStorage.setItem('tai-lab-location:' + accountId, JSON.stringify(selected))
      else sessionStorage.removeItem('tai-lab-location:' + accountId)
    } catch { /* Location is a convenience; answers are stored transactionally. */ }
  }, [selected, accountId])
  useEffect(() => {
    let alive = true
    const instance = new LabSync(accountId, browserHistoryStore(accountId), labTransport(library, accountId))
    setSync(instance)
    setLoaded(false)
    // Load history before mounting an activity: otherwise a cache hit can create a second empty draft on reload.
    void Promise.all([instance.load(), cachedPackages(accountId)]).then(([, content]) => {
      if (alive) { setPackages(content); setLoaded(true) }
    }).catch(e => { if (alive) setError(message(e)) })
    return () => { alive = false; instance.close() }
  }, [library, accountId])
  useEffect(() => {
    if (!sync || !connected) return
    const refresh = () => { if (navigator.onLine) void sync.refresh().catch(e => setError(message(e))) }
    refresh()
    const timer = setInterval(refresh, 60_000)
    window.addEventListener('online', refresh); window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh) }
  }, [sync, connected])
  async function loadDrive() {
    setBusy(true); setError('')
    try {
      for (const file of await library.listLabFiles(accountId, 'labPackage')) {
        await cachePackage(accountId, await library.readLabFile(accountId, file.id, 'labPackage'))
      }
      setPackages(await cachedPackages(accountId))
    } catch (failure) { setError(message(failure)) }
    finally { setBusy(false) }
  }
  async function record(events: LabEvent[]) {
    if (!sync) throw new Error('El almacenamiento todavía no está listo.')
    await sync.record(events)
    if (connected && navigator.onLine) void sync.refresh().catch(e => setError(message(e)))
  }
  return <>
    <div className="lab-toolbar">
      <span role="status">{statusText[history.status]}{history.pendingIds.length > 0 && ` · ${history.pendingIds.length} cambios`}</span>
      {!currentLesson && !currentSession && <button className="button" disabled={!connected || busy} onClick={() => void loadDrive()}><RefreshCw size={16} /> Cargar lecciones de Drive</button>}
      <button className="button icon-button" aria-label="Sincronizar progreso" title="Sincronizar progreso" disabled={!sync || !connected} onClick={() => void sync?.refresh().catch(e => setError(message(e)))}><RefreshCw size={18} /></button>
      <details className="lab-tools"><summary>Opciones de estudio</summary><div>
        <button className="button" disabled={!sync} onClick={() => download('laboratorio-progreso.json', exportHistory(accountId, history.events))}><Download size={16} /> Exportar progreso</button>
        <OfflineControls needsSql={packages.some(p => p.activities.some(a => a.kind === 'sql'))}
          needsPython={packages.some(p => p.activities.some(a => a.kind === 'code' && a.language === 'python'))} />
      </div></details>
    </div>
    {!connected && <p>Copia local de tu biblioteca. Conecta Google Drive para verificar la cuenta y sincronizar.</p>}
    {(error || history.error) && <p className="banner error" role="alert">{error || history.error}</p>}
    {!loaded ? <p role="status">Cargando el historial de este dispositivo…</p> : currentPackage && (currentLesson || currentSession) ? <>
      <button className="text-link" onClick={() => setSelected(undefined)}><ArrowLeft size={16} /> {currentSession ? 'Volver al laboratorio' : 'Volver a las lecciones'}</button>
      {currentSession ? <GuidedSessionView key={`${packageKey(currentPackage)}:session:${currentSession.id}`} pack={currentPackage} session={currentSession}
        accountId={accountId} deviceId={deviceId} events={history.events} record={record} openMaterial={openMaterial} initialPosition={sessionPosition}
        onPosition={position => setSelected(current => current?.pack === packageKey(currentPackage) && current.session === currentSession.id
          ? { ...current, positionId: position.id } : current)}
        renderActivity={activity => <ActivityView key={activity.id} pack={currentPackage} activity={activity} accountId={accountId}
          deviceId={deviceId} events={history.events} record={record} />} />
      : currentLesson && <LessonView key={`${packageKey(currentPackage)}:${currentLesson.id}`} pack={currentPackage} lesson={currentLesson}
        accountId={accountId} deviceId={deviceId} events={history.events} record={record} openMaterial={openMaterial}
        initialActivityId={selected?.activity} onActivityChange={activity => setSelected({ pack: packageKey(currentPackage), lesson: currentLesson.id, activity })} />}
    </> : <>
      {guidedContinuation && <section className="lab-continuation" aria-label="Retomar sesión guiada">
        <div><p className="context-label">Tu sesión guardada</p><h2>{guidedContinuation.session.title}</h2>
          <p>{guidedContinuation.session.stages.find(stage => stage.id === guidedContinuation.position.stageId)?.title}</p></div>
        <button className="button primary" onClick={() => setSelected({ pack: packageKey(guidedContinuation.pack), session: guidedContinuation.session.id,
          positionId: guidedContinuation.position.id })}>Reanudar sesión guiada <ArrowRight size={17} /></button>
      </section>}
      {continuation && <section className="lab-continuation" aria-label="Retomar el laboratorio">
        <div><p className="context-label">Tu última actividad guardada</p><h2>{continuation.lesson.title}</h2>
          <p>Actividad {continuation.activityIndex + 1}: {continuation.activity.title}</p>
          <small>Recupera tu respuesta y las pistas consultadas. Puedes explorar otra lección.</small></div>
        <button className="button primary" onClick={() => {
          try { sessionStorage.setItem(activityLocationKey(accountId, continuation.pack, continuation.lesson) + ':pane', 'practice') }
          catch { /* The explicit activity still opens if session storage is unavailable. */ }
          setSelected({ pack: packageKey(continuation.pack), lesson: continuation.lesson.id, activity: continuation.activity.id })
        }}>Reanudar actividad <ArrowRight size={17} /></button>
      </section>}
      {packages.some(pack => pack.sessions?.length) && <section className="lab-guided-catalog" aria-label="Sesiones guiadas">
        <h2>Sesiones guiadas</h2><p>Recupera, comprende, practica y comprueba lo aprendido.</p>
        <div className="lab-lesson-list">{packages.flatMap(pack => (pack.sessions ?? []).map(session => <button className="lab-lesson"
          key={JSON.stringify([pack.id, pack.version, session.id])} onClick={() => setSelected({ pack: packageKey(pack), session: session.id })}>
          <span><strong>{session.title}</strong><small>{sessionMinutes(session)} min orientativos · 5 etapas</small></span><ArrowRight size={19} aria-hidden="true" />
        </button>))}</div>
      </section>}
      {packages.length > 0 && <LessonCatalog packages={packages} events={history.events} accountId={accountId}
        openLesson={(pack, lesson) => setSelected({ pack: packageKey(pack), lesson: lesson.id })} />}
      {!packages.length && <div className="lab-empty"><h2>Las lecciones se están preparando</h2>
        <p>Se incorporarán al completar sus comprobaciones de contenido y funcionamiento.</p></div>}
      <details className="lab-map"><summary>Mapa de los 19 temas</summary>
        {blocks.filter(b => b.id === 'b3' || b.id === 'b4').map(block => <section key={block.id}>
          <h2>{block.title}</h2><ul>{block.topics.map(topic => <li key={topic.id}>{topic.title}</li>)}</ul>
        </section>)}
      </details>
      <details className="lab-import"><summary>Paquetes y copia del progreso</summary>
        <p>Las respuestas se guardan localmente antes de sincronizar. Prepara el acceso sin conexión antes de desconectarte.</p>
        <label>Importar paquete privado validado<input type="file" accept="application/json,.json" onChange={async event => {
          const file = event.currentTarget.files?.[0]; if (!file) return
          try {
            if (file.size > 32 * 1024 ** 2) throw new Error('El paquete supera 32 MB.')
            await cachePackage(accountId, JSON.parse(await readText(file))); setPackages(await cachedPackages(accountId)); setError('')
          } catch (failure) { setError(message(failure)) }
        }} /></label>
        <label>Restaurar progreso de esta cuenta<input type="file" accept="application/json,.json" onChange={async event => {
          const file = event.currentTarget.files?.[0]; if (!file || !sync) return
          try {
            if (file.size > 32 * 1024 ** 2) throw new Error('La copia supera 32 MB.')
            await record(restoreHistory(accountId, await readText(file), history.events)); setError('')
          } catch (failure) { setError(message(failure)) }
        }} /></label>
      </details>
    </>}
  </>
}

export function LessonView({ pack, lesson, accountId, deviceId, events, record, openMaterial, initialActivityId, onActivityChange }: {
  pack: LabPackage; lesson: Lesson; accountId: string; deviceId: string; events: LabEvent[];
  record: (events: LabEvent[]) => Promise<void>; openMaterial: (resourceId: string, sectionId: string) => void
  initialActivityId?: string; onActivityChange?: (activityId: string) => void
}) {
  const activities = lesson.activityIds.map(id => pack.activities.find(a => a.id === id)!)
  const positionKey = activityLocationKey(accountId, pack, lesson)
  const mobile = useSyncExternalStore(subscribeWidth, () => matchMedia(narrowQuery).matches)
  const [pane, setPane] = useState<'read' | 'practice'>(() => {
    try {
      const remembered = sessionStorage.getItem(positionKey + ':pane')
      if (remembered === 'practice' || remembered === 'read') return remembered
    } catch { /* Use the explicit destination when session storage is unavailable. */ }
    return initialActivityId ? 'practice' : 'read'
  })
  const practice = useRef<HTMLElement>(null)
  const [index, setIndex] = useState(() => {
    const explicit = activities.findIndex(activity => activity.id === initialActivityId)
    if (explicit >= 0) return explicit
    try { const value = Number(sessionStorage.getItem(positionKey)); return Number.isSafeInteger(value) && value >= 0 && value < activities.length ? value : 0 }
    catch { return 0 }
  })
  useEffect(() => { try { sessionStorage.setItem(positionKey, String(index)) } catch { /* Answers still persist independently. */ } }, [index, positionKey])
  function choosePane(next: 'read' | 'practice') {
    setPane(next)
    try { sessionStorage.setItem(positionKey + ':pane', next) } catch { /* Durable answers remain available. */ }
  }
  function chooseActivity(next: number) {
    setIndex(next)
    onActivityChange?.(activities[next].id)
    if (mobile) requestAnimationFrame(() => practice.current?.scrollIntoView({ block: 'start', behavior: 'instant' }))
  }
  const answered = new Set(events.filter((event): event is Attempt => event.kind === 'attempt' && event.accountId === accountId
    && event.packageId === pack.id && event.packageVersion === pack.version && event.outcome !== 'omitted'
    && activities.some(activity => activity.id === event.activityId && activity.version === event.activityVersion)).map(event => event.activityId))
  return <article className="lab-session">
    <header className="lab-lesson-heading"><h2>{lesson.title}</h2><p>{lesson.minutes} minutos de contenido nuevo</p>
      <span>{activities.filter(a => answered.has(a.id)).length} de {activities.length} actividades respondidas</span></header>
    {mobile && <div className="lab-pane-switch" aria-label="Vista de la lección">
      <button aria-pressed={pane === 'read'} onClick={() => choosePane('read')}><BookOpen size={17} /> Leer explicación</button>
      <button aria-pressed={pane === 'practice'} onClick={() => choosePane('practice')}>Practicar <ArrowRight size={17} /></button>
    </div>}
    <div className="lab-session-columns">
      {(!mobile || pane === 'read') && <section aria-label="Explicación y ejemplo" className="lab-explanation">
        {lesson.explanation.map((s, i) => <section key={i}><h3>{s.title}</h3><StudyText text={s.body} /></section>)}
        <div className="lab-example"><h3>Ejemplo resuelto</h3>{lesson.workedExample.map((s, i) => <section key={i}><h4>{s.title}</h4><StudyText text={s.body} /></section>)}</div>
        <button className="text-link" onClick={() => { choosePane('practice'); openMaterial(lesson.material.resourceId, lesson.material.sectionId) }}>Consultar material completo</button>
        {mobile && <button className="button primary lab-start-practice" onClick={() => choosePane('practice')}>Empezar a practicar <ArrowRight size={17} /></button>}
      </section>}
      {(!mobile || pane === 'practice') && <section ref={practice} className="lab-practice" aria-label="Práctica">
        <div className="lab-steps" aria-label="Actividades de la lección">{activities.map((a, i) => <button className="button" key={a.id}
          title={a.title + (answered.has(a.id) ? ' · Respondida' : '')} aria-current={index === i ? 'step' : undefined}
          onClick={() => chooseActivity(i)}>{i + 1}{answered.has(a.id) && <Check size={11} aria-hidden="true" />}</button>)}</div>
        <div className="lab-activity-position"><span>Actividad {index + 1} de {activities.length}</span><span>{activities[index]?.phase === 'practice' ? 'Práctica con apoyo' : 'Comprobación sin pistas'}</span></div>
        {activities[index] && <ActivityView key={activities[index].id} activity={activities[index]} pack={pack} accountId={accountId}
          deviceId={deviceId} events={events} record={record} />}
        <nav className="lab-activity-navigation" aria-label="Cambiar actividad">
          <button className="button" disabled={index === 0} onClick={() => chooseActivity(index - 1)}><ArrowLeft size={17} /> Anterior</button>
          {index < activities.length - 1 ? <button className="button" onClick={() => chooseActivity(index + 1)}>Siguiente <ArrowRight size={17} /></button>
            : <span>Fin de las actividades de esta lección</span>}
        </nav>
      </section>}
    </div>
  </article>
}

export function ActivityView({ activity, pack, accountId, deviceId, events, record }: {
  activity: Activity; pack: LabPackage; accountId: string; deviceId: string; events: LabEvent[];
  record: (events: LabEvent[]) => Promise<void>
}) {
  const ref = { activityId: activity.id, activityVersion: activity.version, packageId: pack.id, packageVersion: pack.version }
  const buffer = draftWriteBuffer(accountId, ref)
  const buffered = useSyncExternalStore(buffer.subscribe, buffer.snapshot)
  useEffect(() => { buffer.acknowledge(events) }, [buffer, events])
  const eventSnapshot = useRef(events)
  eventSnapshot.current = events
  const key = JSON.stringify([pack.id, pack.version, activity.id, activity.version])
  const currentHeads = () => draftHeads(mergeEvents(accountId, eventSnapshot.current, buffer.snapshot().map(entry => entry.note)), key)
  const revisions = useMemo(() => {
    try { return { heads: currentHeads(), error: '' } }
    catch (failure) { return { heads: draftHeads(buffered.map(entry => entry.note), key), error: message(failure) } }
  }, [events, buffered, accountId, key])
  const heads = revisions.heads
  const failed = buffered.filter(entry => entry.status === 'failed')
  const pending = buffered.some(entry => entry.status === 'pending')
  const initialValue = activity.kind === 'choice' ? '' : activity.kind === 'html-css' ? JSON.stringify(activity.starter) : activity.starter
  const [initial] = useState<Draft>(() => ({ ...ref, id: crypto.randomUUID(), kind: 'draft', deviceId, accountId,
    createdAt: new Date().toISOString(), attemptGroupId: heads[0]?.attemptGroupId ?? crypto.randomUUID(), parentIds: [], value: initialValue, position: 0 }))
  const answer = heads.length === 1 ? heads[0].value : initialValue
  const groupId = heads.length === 1 ? heads[0].attemptGroupId : initial.attemptGroupId
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const assistance = assistanceFor(events, groupId)
  const attempts = events.filter((e): e is Attempt => e.kind === 'attempt' && e.attemptGroupId === groupId)
  const currentWork = useRef({ assistance, attempts })
  currentWork.current = { assistance, attempts }
  const attemptFacts = () => {
    const facts = currentWork.current
    return { ...facts.assistance,
      ordinal: Math.max(0, ...facts.attempts.map(a => a.ordinal)) + 1 }
  }
  const latest = attempts.reduce<typeof attempts[number] | undefined>((current, a) => a.kind === 'attempt'
    && (!current || (current.kind === 'attempt' && a.ordinal > current.ordinal)) ? a : current, undefined)
  const [clock] = useState(() => new ActiveTime(performance.now(), document.visibilityState === 'visible'))
  useEffect(() => {
    const update = () => clock.visibility(performance.now(), document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [clock])
  const activeMs = () => clock.take(performance.now(), document.visibilityState === 'visible')
  const [exposure] = useState<LabEvent>(() => ({ id: crypto.randomUUID(), kind: 'exposure', accountId, deviceId,
    createdAt: new Date().toISOString(), familyId: activity.familyId, reason: 'presented' }))
  useEffect(() => {
    void record(heads.length ? [exposure] : [initial, exposure]).catch(e => setError(message(e)))
  }, []) // The immutable initial event is reused if React replays this effect.
  async function save(value: string) {
    const parents = currentHeads()
    if (parents.length > 1) throw new Error('Elige qué borrador continuar antes de editar.')
    if (parents[0]?.value !== value) {
      const draft: Draft = { ...initial, id: crypto.randomUUID(), createdAt: new Date().toISOString(), value,
        attemptGroupId: parents[0]?.attemptGroupId ?? initial.attemptGroupId, parentIds: (parents.length ? parents : [initial]).map(d => d.id) }
      // Begin every local transaction immediately; navigation may close this controller afterward.
      if (!await buffer.save(draft, record)) throw new Error('El borrador sigue pendiente de guardar. Puedes reintentarlo o descargar una copia.')
    }
    if (!await buffer.flush()) throw new Error('Hay revisiones pendientes de guardar. Reintenta el guardado antes de continuar.')
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await action() } catch (failure) { setError(message(failure)) }
    finally { setBusy(false) }
  }
  async function revealSolution() {
    await record([{ ...ref, id: crypto.randomUUID(), kind: 'assistance', accountId, deviceId,
      createdAt: new Date().toISOString(), attemptGroupId: groupId, hintCount: assistance.hintCount, solutionViewed: true },
    { id: crypto.randomUUID(), kind: 'exposure', accountId, deviceId, createdAt: new Date().toISOString(),
      familyId: activity.familyId, reason: 'solution' }])
  }
  async function submitChoice(value: string | null) {
    if (activity.kind !== 'choice') return
    if (!await buffer.flush()) throw new Error('Guarda el borrador antes de comprobar la respuesta.')
    const result = gradeChoice(activity, value)
    await record([{ ...ref, id: crypto.randomUUID(), kind: 'attempt', deviceId, accountId, createdAt: new Date().toISOString(),
      familyId: activity.familyId, objectiveIds: activity.objectiveIds, attemptGroupId: groupId,
      answer: value, ...result, ...attemptFacts(), activeMs: activeMs(), phase: activity.phase, gradingVersion: 'choice-v1' }])
  }
  return <div className="lab-activity">
    <h3>{activity.title}</h3><p className="lab-mode">{activity.mode.kind === 'real' ? 'Ejecución real' : activity.mode.kind === 'trace' ? 'Traza de referencia' : 'Simulación'} · {activity.mode.engine} {activity.mode.version}</p>
    <StudyText text={activity.prompt} />
    <details className="lab-prediction"><summary>Anotar una predicción (opcional)</summary>
      <StudyNoteEditor target={{ ...ref, kind: 'activity', purpose: 'prediction' }} accountId={accountId} deviceId={deviceId}
        events={events} record={record} label="Tu predicción" />
    </details>
    {(pending || failed.length > 0) && <section aria-label="Guardado del borrador">
      <p role="status">{pending ? 'Guardando borrador…' : 'Borrador pendiente de guardar.'}</p>
      {failed.length > 0 && <><p role="alert">{failed[0].error} El texto sigue disponible en esta pestaña. {failed.some(entry => entry.collision)
        ? 'Guarda una copia antes de cerrarla.' : 'Reintenta el guardado antes de cerrarla.'}</p>
        <div className="lab-actions"><button className="button" disabled={pending || failed.every(entry => entry.collision)} onClick={() => {
          buffer.retry(record)
          void buffer.flush().then(saved => { if (saved) setError('') })
        }}>Reintentar guardar borrador</button>
          <button className="button" onClick={() => download('laboratorio-borradores-pendientes.json', exportHistory(accountId, buffered.map(entry => entry.note)))}>Guardar copia del borrador pendiente</button></div></>}
    </section>}
    {revisions.error ? <div role="alert"><p>{revisions.error}</p><label>Borrador pendiente<textarea readOnly rows={8} value={answer} /></label></div>
      : heads.length > 1 ? <div role="alert"><h4>Hay dos borradores de esta actividad</h4>
      <p>Elige cuál continuar. Las versiones anteriores se conservarán en el historial.</p>
      {heads.map(head => <button className="button" key={head.id} disabled={busy || pending || failed.length > 0} onClick={() => void run(async () => {
        const resolved = { ...head, id: crypto.randomUUID(), deviceId, createdAt: new Date().toISOString(), parentIds: heads.map(d => d.id) }
        if (!await buffer.save(resolved, record)) throw new Error('La elección del borrador sigue pendiente de guardar.')
      })}>Continuar: {head.value || 'Sin respuesta'}</button>)}
    </div> : activity.kind === 'choice' ? <>
      <fieldset disabled={busy || heads.length === 0}><legend>Elige una respuesta</legend>
        {activity.options.map(option => <label key={option.id} className="lab-option"><input type="radio" name={activity.id}
          value={option.id} checked={answer === option.id} onChange={() => { void run(() => save(option.id)) }} /><span>{option.text}</span></label>)}
      </fieldset>
      <div className="lab-actions"><button className="button primary" disabled={busy || !answer} onClick={() => void run(() => submitChoice(answer))}>Comprobar respuesta</button>
        <button className="button" disabled={busy || heads.length !== 1 || latest?.outcome === 'omitted'}
          onClick={() => void run(() => submitChoice(null))}>Dejar sin responder</button>
      </div>
      {latest?.kind === 'attempt' && <div className="lab-feedback" role="status"><strong>{latest.outcome === 'omitted' ? 'Sin respuesta' : latest.outcome === 'correct' ? 'Respuesta correcta' : 'Revisa la respuesta'}{latest.hintCount > 0 || latest.solutionViewed ? ' · Con ayuda' : ''}</strong>
        <p>{latest.feedback}</p>{latest.outcome !== 'omitted' && <details onToggle={event => {
          if (event.currentTarget.open && !assistance.solutionViewed) void run(revealSolution)
        }}><summary>Por qué cada opción</summary>{activity.options.map(o => <p key={o.id}><strong>{o.text}:</strong> {o.explanation}</p>)}</details>}</div>}
    </> : activity.kind === 'html-css' ? <HtmlPanel activity={activity} saved={answer} disabled={heads.length === 0 || busy}
      save={save} onResult={async (value, correct, feedback) => {
        await record([{ ...ref, id: crypto.randomUUID(), kind: 'attempt', deviceId, accountId, createdAt: new Date().toISOString(),
          familyId: activity.familyId, objectiveIds: activity.objectiveIds, attemptGroupId: groupId,
          answer: value, outcome: correct ? 'correct' : 'incorrect', ...attemptFacts(), activeMs: activeMs(),
          phase: activity.phase, gradingVersion: 'html-dom-css-v1', feedback }])
      }} /> : activity.kind === 'code' ? <CodePanel activity={activity} saved={answer} disabled={heads.length === 0 || busy}
      save={save} onResult={async (value, correct, feedback) => {
        await record([{ ...ref, id: crypto.randomUUID(), kind: 'attempt', deviceId, accountId, createdAt: new Date().toISOString(),
          familyId: activity.familyId, objectiveIds: activity.objectiveIds, attemptGroupId: groupId,
          answer: value, outcome: correct ? 'correct' : 'incorrect', ...attemptFacts(), activeMs: activeMs(),
          phase: activity.phase, gradingVersion: 'stdout-datasets-v1', feedback }])
      }} /> : <SqlPanel activity={activity} saved={answer} disabled={heads.length === 0 || busy}
      save={save} onResult={async (value, correct, feedback) => {
        await record([{ ...ref, id: crypto.randomUUID(), kind: 'attempt', deviceId, accountId, createdAt: new Date().toISOString(),
          familyId: activity.familyId, objectiveIds: activity.objectiveIds, attemptGroupId: groupId,
          answer: value, outcome: correct ? 'correct' : 'incorrect', ...attemptFacts(),
          activeMs: activeMs(), phase: activity.phase, gradingVersion: 'sql-datasets-v1',
          feedback: feedback ?? (correct ? 'La consulta satisface los casos comprobados.' : 'La consulta no coincide con el resultado requerido en todos los casos.') }])
      }} />}
    {latest && latest.ordinal > 1 && <p className="lab-mode">Intento {latest.ordinal}. Tu primera respuesta se conserva.</p>}
    {heads.length === 1 && activity.phase === 'practice' && <>
      <div className="lab-actions">
        {activity.phase === 'practice' && assistance.hintCount < activity.hints.length && <button className="button" disabled={busy}
          onClick={() => void run(() => record([{ ...ref, accountId, deviceId, id: crypto.randomUUID(), kind: 'assistance',
            attemptGroupId: groupId, createdAt: new Date().toISOString(), hintCount: assistance.hintCount + 1, solutionViewed: assistance.solutionViewed }]))}>Pista {assistance.hintCount + 1}</button>}
        {activity.phase === 'practice' && !assistance.solutionViewed && <button className="button" disabled={busy}
          onClick={() => void run(revealSolution)}>Ver solución</button>}
      </div>
      {activity.hints.slice(0, assistance.hintCount).map((hint, i) => <p className="lab-feedback" key={i}>Pista {i + 1}: {hint}</p>)}
      {assistance.solutionViewed && <p className="lab-feedback">{activity.solution}</p>}
    </>}
    {error && <p role="alert">{error}</p>}
    <details><summary>Fuentes y límites</summary><p>{activity.mode.limits}</p>
      {activity.claims.map((claim, i) => { const source = pack.sources.find(s => s.id === claim.sourceId)!; return <p key={i}>{claim.text} · <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>, {source.edition}, {claim.locator}</p> })}
    </details>
  </div>
}

function SqlPanel({ activity, saved, disabled, save, onResult }: {
  activity: SqlActivity; saved: string; disabled: boolean; save: (value: string) => Promise<void>;
  onResult: (value: string, correct: boolean, feedback?: string) => Promise<void>
}) {
  const [query, setQuery] = useState(saved)
  useEffect(() => { setQuery(saved) }, [saved])
  const [result, setResult] = useState<SqlResult>()
  const [status, setStatus] = useState('')
  const [running, setRunning] = useState(false)
  const controller = useRef<AbortController>(undefined)
  useEffect(() => () => controller.current?.abort(), [])
  async function execute(check: boolean) {
    setRunning(true); setStatus('Preparando el motor SQL…'); setResult(undefined)
    controller.current = new AbortController()
    try {
      await save(query)
      const { runSql } = await import('./sql-runner')
      const signal = controller.current.signal
      setStatus(check ? 'Comprobando varios conjuntos de datos…' : 'Ejecutando consulta…')
      let correct = true
      for (const [i, dataset] of activity.datasets.entries()) {
        const actual = await runSql(dataset.setup, query, signal)
        if (i === 0) setResult(actual)
        if (!check) break
        const expected = await runSql(dataset.setup, activity.referenceQuery, signal)
        correct = correct && actual.columns.length === expected.columns.length && compareSqlRows(actual.rows, expected.rows, activity.comparison)
      }
      if (check) await onResult(query, correct)
      setStatus(check ? correct ? 'Correcta en los casos comprobados.' : 'Revisa la consulta: algún caso produce otro resultado.' : 'Consulta ejecutada. Puedes modificarla o comprobarla.')
    } catch (failure) {
      if (check && failure instanceof Error && failure.name === 'SqlQueryError') {
        try { await onResult(query, false, failure.message) }
        catch (saving) { setStatus(message(saving)); return }
      }
      setStatus(message(failure))
    }
    finally { setRunning(false) }
  }
  return <div className="lab-sql">
    <details><summary>Tablas y datos iniciales</summary><pre>{activity.datasets[0].setup}</pre></details>
    <label htmlFor={`query-${activity.id}`}>Consulta SQL</label>
    <textarea id={`query-${activity.id}`} value={query} rows={8} spellCheck={false} disabled={running || disabled}
      onChange={e => { setQuery(e.target.value); void save(e.target.value).catch(() => {}) }} onBlur={() => { if (query !== saved) void save(query).catch(() => {}) }} />
    <div className="lab-actions"><button className="button" disabled={running || disabled} onClick={() => void execute(false)}>Ejecutar SQL</button>
      <button className="button primary" disabled={running || disabled} onClick={() => void execute(true)}>Comprobar SQL</button>
      <button className="button" disabled={running || disabled} onClick={() => { setQuery(activity.starter); void save(activity.starter).catch(() => {}); setResult(undefined) }}>Restablecer consulta</button>
      {running && <button className="button" onClick={() => controller.current?.abort()}>Cancelar ejecución</button>}
    </div>
    <p role="status">{status}</p>
    {result && <div className="lab-sql-table" tabIndex={0} role="region" aria-label="Resultado de la consulta"><table>
      <thead><tr>{result.columns.map((column, i) => <th key={i} scope="col">{column}</th>)}</tr></thead>
      <tbody>{result.rows.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j}>{value === null ? 'NULL' : String(value)}</td>)}</tr>)}</tbody>
    </table><p>{result.rows.length} {result.rows.length === 1 ? 'fila' : 'filas'}.</p></div>}
  </div>
}
