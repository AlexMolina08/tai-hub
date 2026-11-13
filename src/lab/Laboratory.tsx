import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Download, RefreshCw, Settings2 } from 'lucide-react'
import type { DriveLibrary } from '../drive/library'
import type { Activity, Attempt, Draft, LabEvent, LabPackage, Lesson, SessionPosition } from './model'
import { SQL_GRADING_VERSION } from './sql-output'
import { LabSync, type LabSnapshot } from './sync'
import { browserHistoryStore } from './store'
import { labTransport, loadLabCatalogue } from './drive'
import { cachePackages, cachedPackages } from './content-store'
import { readPackageFiles } from './package-files'
import { assistanceFor, gradeChoice } from './grading'
import { draftHeads, exportHistory, mergeEvents, restoreHistory } from './history'
import { clearDraftBuffers, draftWriteBuffer } from './draft-buffer'
import { ActiveTime } from './active-time'
import { OfflineControls } from './OfflineControls'
import { SqlPanel } from './SqlPanel'
import { CodePanel } from './CodePanel'
import { HtmlPanel } from './HtmlPanel'
import { IPv4Panel } from './IPv4Panel'
import { SignalPanel } from './SignalPanel'
import { PredictionPanel, predictionFor } from './PredictionPanel'
import { isPredictionActivity, parsePredictionDraft } from './prediction'
import { createIPv4View, parseIPv4View, serializeIPv4View } from './ipv4-workflow'
import { StudyText } from './StudyText'
import { activityLocationKey, readingLocationKey, savedReading, studyContinuation } from './continuation'
import { latestLabPackages, StudyMap, nextCatalogueLesson, nextCatalogueTopic, studyTopicForLesson } from './LessonCatalog'
import { GuidedSessionView } from './GuidedSessionView'
import { sessionMinutes, sessionPositions } from './guided'
import { StudyNoteEditor } from './StudyNoteEditor'
import { LearningCapture } from './learning-capture'
import { clearSemanticBuffers, semanticWriteBuffer } from './semantic-buffer'
import { clearNoteBuffers } from './note-buffer'
import { Dialog } from '../components/Dialog'
import { LearningReading } from './LearningReading'
import { LearningDashboard, TopicLearning } from './LearningDashboard'
import { diagnosticOrder, diagnosticTargets, InitialDiagnostic } from './InitialDiagnostic'
import { clearExamBuffers, ExamCatalog, ExamView } from './ExamView'
import { DEFAULT_LEARNING_POLICY, deriveLearning } from './learning'
import { recommendLearning, type LearningDestination } from './recommendation'
import { labBlocks } from './study-scope'
import { useStudyNavigation, type LabSection, type StudyLocation } from './study-navigation'
import './laboratory.css'
import './study-interface.css'

const empty: LabSnapshot = { events: [], pendingIds: [], status: 'local' }
const idle = () => () => {}
const statusText = { local: 'Guardado en este dispositivo', pending: 'Pendiente de sincronizar', syncing: 'Sincronizando', synced: 'Sincronizado', error: 'Revisa el guardado o la conexión' }
const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.'
const packageKey = (pack: LabPackage) => JSON.stringify([pack.id, pack.version])
type StudyAction = { label: string; run: () => void }
function focusStudyHeading(heading?: HTMLElement | null) {
  heading?.focus({ preventScroll: true })
  heading?.scrollIntoView({ block: 'start', behavior: 'instant' })
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

type LabConnection = { connected: boolean; canConnect: boolean; reconnect: () => void }
type LabProps = LabConnection & { library: DriveLibrary; openMaterial: (resourceId: string, sectionId: string) => void }

export default function Laboratory({ accountId, ...props }: LabProps & { accountId?: string }) {
  return <section className="laboratory" aria-label="Laboratorio TAI">
    {accountId ? <Workspace key={accountId} accountId={accountId} {...props} /> : <>
      <div className="page-heading"><h1>Laboratorio TAI</h1></div>
      <section className="lab-empty">
        <h2>Empieza a estudiar</h2>
        <p>Conecta Google Drive para cargar tus lecciones y tu progreso privado.</p>
        <button className="button primary" disabled={!props.canConnect} onClick={props.reconnect}>Conectar Google Drive</button>
      </section>
    </>}
  </section>
}

function Workspace({ library, accountId, connected, canConnect, reconnect, openMaterial }: LabProps & { accountId: string }) {
  const [sync, setSync] = useState<LabSync>()
  const history = useSyncExternalStore(sync?.subscribe ?? idle, sync?.snapshot ?? (() => empty))
  const [deviceId] = useState(deviceIdentity)
  const [packages, setPackages] = useState<LabPackage[]>([])
  const [loaded, setLoaded] = useState(false)
  const navigation = useStudyNavigation(accountId)
  const { section, topic: mapTopic, selected } = navigation.route
  const setSelected = navigation.updateSelected
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [installStatus, setInstallStatus] = useState('')
  const [skippedProposals, setSkippedProposals] = useState<string[]>([])
  const [sessionBlock, setSessionBlock] = useState('')
  const [showDiagnostic, setShowDiagnostic] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetNotice, setResetNotice] = useState(false)
  const generationId = history.generation?.id
  const [activeGeneration, setActiveGeneration] = useState(() => {
    try { return sessionStorage.getItem('tai-lab-history-generation:' + accountId) ?? undefined }
    catch { return undefined }
  })
  const studyView = useRef<HTMLDivElement>(null)
  const diagnosticSummary = useRef<HTMLElement>(null)
  const focusDestination = useRef(false)
  const drivePackageInput = useRef<HTMLInputElement>(null)
  const currentPackage = packages.find(p => packageKey(p) === selected?.pack)
  const currentLesson = currentPackage?.lessons.find(l => l.id === selected?.lesson)
  const standalone = !selected?.lesson && !selected?.session && selected?.group
    ? currentPackage?.activities.find(activity => activity.id === selected?.activity) : undefined
  const currentSession = currentPackage?.sessions?.find(session => session.id === selected?.session)
  const currentExam = currentPackage?.exams?.find(form => form.id === selected?.exam)
  const isStudying = !!(currentLesson || currentSession || currentExam || standalone)
  const unavailable = loaded && !!selected && !isStudying
  const needsRecommendations = !isStudying && (section === 'review' || section === 'map' && !!mapTopic) || !!selected?.proposal
  const sessionPosition = history.events.find((event): event is SessionPosition => event.kind === 'session-position'
    && event.id === selected?.positionId && event.accountId === accountId && event.packageId === currentPackage?.id
    && event.packageVersion === currentPackage?.version && event.sessionId === currentSession?.id && event.sessionVersion === currentSession?.version)
  const continuation = useMemo(() => !isStudying && studyContinuation(packages, history.events, accountId), [isStudying, packages, history.events, accountId])
  const sessionHistory = useMemo(() => sessionPositions(packages, history.events, accountId), [packages, history.events, accountId])
  const guidedContinuation = !isStudying && sessionHistory.find(({ position }) => !position.completed)
  const [evaluatedAt, setEvaluatedAt] = useState(() => new Date().toISOString())
  useEffect(() => {
    const update = () => setEvaluatedAt(new Date().toISOString())
    const timer = setInterval(update, 60_000)
    window.addEventListener('focus', update)
    return () => { clearInterval(timer); window.removeEventListener('focus', update) }
  }, [])
  const learning = useMemo(() => {
    if (!needsRecommendations) return { snapshot: null, error: '' }
    try { return { snapshot: deriveLearning({ accountId, packages, events: history.events, now: evaluatedAt, policy: DEFAULT_LEARNING_POLICY }), error: '' } }
    catch (failure) { return { snapshot: null, error: message(failure) } }
  }, [accountId, packages, history.events, evaluatedAt, needsRecommendations])
  const targets = useMemo(() => diagnosticTargets(packages), [packages])
  const orderedDiagnostic = useMemo(() => diagnosticOrder(targets), [targets])
  const currentEditions = useMemo(() => [...latestLabPackages(packages).values()], [packages])
  const queue = useMemo(() => learning.snapshot ? recommendLearning({ packages, currentEditions, events: history.events, learning: learning.snapshot,
    skipped: selected?.proposal ? [...skippedProposals, selected.proposal] : skippedProposals }) : undefined,
  [packages, currentEditions, history.events, learning.snapshot, skippedProposals, selected?.proposal])
  const lessonTopic = currentLesson && currentPackage ? studyTopicForLesson(currentPackage, currentLesson, selected?.topic)?.id : undefined
  const nextLesson = useMemo(() => currentLesson && currentPackage
    ? nextCatalogueLesson(packages, history.events, accountId, currentPackage, currentLesson, lessonTopic) : undefined,
  [packages, history.events, accountId, currentPackage, currentLesson, lessonTopic])

  function openLocation(location: StudyLocation, replace = isStudying) {
    setInstallStatus('')
    if (location.lesson && location.activity) {
      const pack = packages.find(item => packageKey(item) === location.pack)
      const lesson = pack?.lessons.find(item => item.id === location.lesson)
      if (pack && lesson) {
        try { sessionStorage.setItem(activityLocationKey(accountId, pack, lesson) + ':pane', 'practice') }
        catch { /* The activity is still included in the navigation destination. */ }
      }
    }
    focusDestination.current = true
    navigation.navigate({ section, topic: mapTopic, selected: location }, replace)
  }

  function openRecommendation(target: LearningDestination, proposal?: string) {
    const pack = packages.find(pack => pack.id === target.packageId && pack.version === target.packageVersion)
    if (!pack) return
    if (target.kind === 'session') openLocation({ pack: packageKey(pack), session: target.sessionId, positionId: target.positionId, proposal })
    else if (target.kind === 'lesson') {
      openLocation({ pack: packageKey(pack), lesson: target.lessonId, activity: target.activityId, proposal })
    } else openLocation({ pack: packageKey(pack), activity: target.activityId, group: target.attemptGroupId ?? crypto.randomUUID(), proposal })
  }

  function openLesson(pack: LabPackage, lesson: Lesson, topic?: string) {
    openLocation({ pack: packageKey(pack), lesson: lesson.id, topic })
  }

  function openSection(next: LabSection) {
    focusDestination.current = next !== 'map'
    setInstallStatus('')
    navigation.navigate({ section: next })
  }

  function closeSettings() {
    navigation.close({ section: 'map' })
  }

  function returnFromStudy() {
    navigation.close({ section, topic: mapTopic ?? lessonTopic })
  }
  const diagnosticIndex = orderedDiagnostic.findIndex(target => target.attemptGroupId === selected?.group)
  const diagnosticTarget = diagnosticIndex < 0 ? undefined : [...orderedDiagnostic.slice(diagnosticIndex + 1), ...orderedDiagnostic.slice(0, diagnosticIndex)]
    .find(target => !history.events.some(event => event.kind === 'attempt' && event.attemptGroupId === target.attemptGroupId && event.outcome !== 'omitted'))
  const diagnosticAction: StudyAction | undefined = diagnosticIndex < 0 ? undefined : diagnosticTarget
    ? { label: 'Siguiente ejercicio', run: () => openRecommendation(diagnosticTarget) }
    : { label: 'Ver resultados del diagnóstico', run: () => { setShowDiagnostic(true); navigation.navigate({ section: 'review' }, true) } }
  const proposalAction: StudyAction | undefined = selected?.proposal ? {
    label: queue?.items.length ? 'Siguiente propuesta' : 'Ver propuestas',
    run: () => {
      const next = queue?.items[0]
      setSkippedProposals(current => [...current, selected.proposal!])
      if (next) openRecommendation(next.target, next.id)
      else { focusDestination.current = true; navigation.navigate({ section: 'review' }, true) }
    },
  } : undefined
  useEffect(() => {
    if (!loaded || activeGeneration === generationId) return
    clearDraftBuffers(accountId)
    clearSemanticBuffers(accountId)
    clearNoteBuffers(accountId)
    clearExamBuffers(accountId)
    try {
      const prefix = JSON.stringify(['tai-lab-activity', accountId]).slice(0, -1) + ','
      for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix)) sessionStorage.removeItem(key)
      for (const key of Object.keys(localStorage)) if (key.startsWith(prefix) && key.endsWith(':read-top')) localStorage.removeItem(key)
      localStorage.removeItem(readingLocationKey(accountId))
      sessionStorage.removeItem('tai-lab-location:' + accountId)
      if (generationId) sessionStorage.setItem('tai-lab-history-generation:' + accountId, generationId)
      else sessionStorage.removeItem('tai-lab-history-generation:' + accountId)
    } catch { /* Account history remains reset in local storage and Drive. */ }
    navigation.navigate({ section: 'map' }, true)
    setSkippedProposals([])
    setShowDiagnostic(false)
    setActiveGeneration(generationId)
  }, [accountId, loaded, activeGeneration, generationId])
  useEffect(() => {
    if (!focusDestination.current) return
    focusDestination.current = false
    focusStudyHeading(studyView.current?.querySelector<HTMLElement>('[data-study-heading]'))
  }, [selected, section, mapTopic])
  useEffect(() => {
    if (!selected && showDiagnostic) focusStudyHeading(diagnosticSummary.current)
  }, [selected, showDiagnostic])

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
    if (!sync || !connected || !loaded) return
    const refresh = () => {
      if (navigator.onLine && document.visibilityState === 'visible') void sync.refresh().catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, 60_000)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [sync, connected, loaded])
  async function loadDrive() {
    setBusy(true); setError(''); setInstallStatus('Buscando paquetes en Drive…')
    try {
      let completion = ''
      const catalogue = await loadLabCatalogue(library, accountId, (ready, total) => {
        if (ready === total) {
          completion = total === 0 ? 'Drive todavía no tiene paquetes del Laboratorio.' :
            `${ready} de ${total} paquetes de Drive disponibles en este dispositivo`
        } else setInstallStatus(`${ready} de ${total} paquetes de Drive disponibles en este dispositivo`)
      })
      setPackages(catalogue)
      setInstallStatus(section === 'settings' || catalogue.length === 0 ? completion : '')
    } catch (failure) {
      setError(message(failure))
      setInstallStatus(status => status === 'Buscando paquetes en Drive…' ? '' : status)
      try { setPackages(await cachedPackages(accountId)) }
      catch (readFailure) { setError(message(readFailure)) }
    } finally {
      setBusy(false)
    }
  }
  async function installFiles(files: File[], saveToDrive: boolean) {
    if (!files.length || busy) return
    setBusy(true); setError(''); setInstallStatus('Validando paquetes…')
    try {
      const { content, uploads } = await readPackageFiles(files)
      const saveLocal = async () => {
        await cachePackages(accountId, content)
        setPackages(await cachedPackages(accountId))
      }
      if (saveToDrive) {
        await library.installLabPackages(accountId, uploads, saveLocal, completed => {
          setInstallStatus(`${completed} de ${uploads.length} paquetes instalados en Drive`)
        })
      } else {
        await saveLocal()
        setInstallStatus(`${content.length} paquetes comprobados en este dispositivo`)
      }
    } catch (failure) { setError(message(failure)) }
    finally { setBusy(false); setInstallStatus(status => status === 'Validando paquetes…' ? '' : status) }
  }
  async function record(events: LabEvent[]) {
    if (!sync) throw new Error('El almacenamiento todavía no está listo.')
    await sync.record(events, generationId ?? null)
    if (connected && navigator.onLine) void sync.refresh().catch(() => {})
  }
  async function resetHistory() {
    if (!sync || !connected || resetting) return
    setResetting(true); setError(''); setResetNotice(false)
    try {
      await sync.reset()
      setResetNotice(true)
      setResetOpen(false)
    } catch (failure) { setError(message(failure)) }
    finally { setResetting(false) }
  }
  const ready = loaded && activeGeneration === generationId
  const hasCatalogue = packages.length > 0
  const readingContinuation = !isStudying ? savedReading(accountId, packages) : undefined
  const resumeReading = readingContinuation && (!continuation || Date.parse(readingContinuation.savedAt) >= Date.parse(continuation.savedAt))
    && (!guidedContinuation || Date.parse(readingContinuation.savedAt) >= Date.parse(guidedContinuation.position.createdAt)) ? readingContinuation : undefined
  const resumeSession = !resumeReading && guidedContinuation && (!continuation
    || packageKey(continuation.pack) === packageKey(guidedContinuation.pack)
      && continuation.activity.id === guidedContinuation.position.activityId
    || Date.parse(guidedContinuation.position.createdAt) >= Date.parse(continuation.savedAt)) ? guidedContinuation : undefined
  const resumeLesson = resumeSession || resumeReading ? undefined : continuation || undefined
  const resumeDestination = resumeReading ?? resumeLesson
  const resumeTopic = resumeDestination && studyTopicForLesson(resumeDestination.pack, resumeDestination.lesson)?.id
  const startingTopic = useMemo(() => currentEditions.flatMap(pack => pack.lessons.flatMap(lesson => studyTopicForLesson(pack, lesson) ?? []))
    .sort((a, b) => Number(b.block === 'III') - Number(a.block === 'III') || Number(b.block === 'IV') - Number(a.block === 'IV')
      || a.id.localeCompare(b.id, 'es', { numeric: true }))[0], [currentEditions])
  const nextTopic = lessonTopic && !nextLesson ? nextCatalogueTopic(packages, lessonTopic) : undefined
  const catalogueLoad = <button className="button" disabled={!connected || busy} onClick={() => void loadDrive()}>
    <RefreshCw size={16} aria-hidden="true" /> Cargar lecciones de Drive
  </button>
  const installButton = <button className="button" disabled={!loaded || !connected || busy} onClick={() => drivePackageInput.current?.click()}>
    Instalar paquetes privados en Drive
  </button>
  const sessionRows = useMemo(() => currentEditions.flatMap(pack => (pack.sessions ?? []).map(session => ({
    pack, session, topics: [...new Set(pack.objectives.filter(objective => session.objectiveIds.includes(objective.id)).map(objective => objective.topicId))],
  }))), [currentEditions])
  function sessionsFor(topic?: string) {
    const rows = topic ? sessionRows.filter(row => row.topics.includes(topic)) : sessionRows
    if (!rows.length) return null
    const blocks = labBlocks.filter(block => rows.some(row => row.topics.some(id => id.startsWith(block.roman + '.'))))
    const visible = topic || !sessionBlock || blocks.length < 2 ? rows : rows.filter(row => row.topics.some(id => id.startsWith(sessionBlock + '.')))
    return <section className="lab-secondary-section" aria-label="Sesiones guiadas">
      <h2>Sesiones guiadas</h2>
      {!topic && blocks.length > 1 && <div className="lab-review-filters"><label>Bloque de la sesión
        <select value={sessionBlock} onChange={event => setSessionBlock(event.target.value)}>
          <option value="">Todos los bloques</option>
          {blocks.map(block => <option key={block.roman} value={block.roman}>{block.roman} · {block.title}</option>)}
        </select></label></div>}
      {visible.map(({ pack, session, topics }) => {
        const saved = sessionHistory.find(entry => entry.pack === pack && entry.session === session)?.position
        return <button className="lab-study-row" key={JSON.stringify([pack.id, pack.version, session.id])}
          onClick={() => openLocation({ pack: packageKey(pack), session: session.id, positionId: saved?.id })}>
          <span><strong>{session.title}</strong><small>{!topic && topics.length > 0 && `${topics.join(', ')} · `}{sessionMinutes(session)} min orientativos
            {saved && (saved.completed ? ' · Completada' : ` · ${session.stages.find(stage => stage.id === saved.stageId)?.title ?? 'En curso'}`)}</small></span><ArrowRight size={18} aria-hidden="true" />
        </button>
      })}
    </section>
  }
  const syncStatus = history.pendingIds.length ? `Guardado aquí · ${history.pendingIds.length} por sincronizar`
    : connected || history.status === 'error' ? statusText[history.status] : 'Guardado aquí'
  return <>
    <header className={isStudying ? 'lab-workspace-header lab-workspace-compact' : 'lab-workspace-header'}>
      {isStudying ? <><h1 className="sr-only">Laboratorio TAI</h1><button className="text-link lab-context-back" onClick={returnFromStudy}
        aria-label={currentLesson ? 'Volver al tema' : undefined}><ArrowLeft size={16} aria-hidden="true" />
        {currentLesson ? lessonTopic ? `Tema ${lessonTopic}` : 'Volver al temario' : currentExam ? section === 'map' ? 'Volver al tema' : 'Volver a exámenes' : 'Volver al laboratorio'}
      </button></> : <h1>Laboratorio TAI</h1>}
      <div className="lab-workspace-status">
        {connected && section !== 'settings' ? <button className="lab-sync-status text-link" type="button" aria-label="Sincronizar progreso"
          title="Sincronizar progreso" disabled={!sync} onClick={() => void sync?.refresh().catch(() => {})}>
          <span role="status">{syncStatus}</span>
        </button> : isStudying && !connected ? <button className="lab-sync-status text-link" type="button"
          aria-label="Reconectar" disabled={!canConnect} onClick={reconnect}>
          <span role="status">{syncStatus}</span><span className="lab-reconnect-label" aria-hidden="true">Reconectar</span>
        </button> : <span role="status">{syncStatus}</span>}
        <button className="icon-button lab-settings-button" aria-label="Ajustes del Laboratorio" title="Ajustes del Laboratorio"
          onClick={() => { if (section === 'settings') closeSettings(); else openSection('settings') }}><Settings2 size={18} aria-hidden="true" /></button>
      </div>
    </header>
    {!isStudying && <nav className="lab-destinations" aria-label="Secciones del Laboratorio">
      {([['map', 'Temario'], ['review', 'Repaso'], ['exams', 'Exámenes']] as const).map(([key, label]) =>
        <button type="button" key={key} aria-current={section === key ? 'page' : undefined}
          onClick={() => { if (section !== key) openSection(key) }}>{label}</button>)}
    </nav>}
    {(error || history.error && !isStudying) && <p className="banner error" role="alert">{error || history.error}</p>}
    {installStatus && !isStudying && <p className="lab-catalogue-status" role="status">{installStatus}</p>}
    {unavailable && <p role="status">La edición guardada no está disponible en este dispositivo. Puedes cargarla desde Ajustes.</p>}
    {resetNotice && !selected && <p className="banner success" role="status">Historial del laboratorio reiniciado.</p>}
    <input ref={drivePackageInput} type="file" accept="application/json,.json" multiple hidden
      aria-label="Instalar paquetes privados en Drive" disabled={!loaded || !connected || busy} onChange={event => {
        const files = Array.from(event.currentTarget.files ?? [])
        event.currentTarget.value = ''
        void installFiles(files, true)
      }} />
    <div ref={studyView}>
    {!ready ? <p role="status">Cargando el historial de este dispositivo…</p> : currentPackage && (currentLesson || currentSession || currentExam || standalone) ? <>
      {currentExam ? <ExamView key={JSON.stringify([packageKey(currentPackage), currentExam.id])} pack={currentPackage} form={currentExam} initialRun={selected?.examRun}
        accountId={accountId} deviceId={deviceId} events={history.events} record={record}
        onRunChange={examRun => setSelected(current => current?.exam === currentExam.id && current.pack === packageKey(currentPackage)
          ? { ...current, examRun } : current)} />
      : standalone ? <article className="lab-standalone">
        <p className="lab-study-context">{diagnosticIndex >= 0 ? `Diagnóstico inicial · Ejercicio ${diagnosticIndex + 1} de ${orderedDiagnostic.length}`
          : standalone.phase === 'delayed' ? 'Repaso diferido' : standalone.phase === 'reserved' ? 'Comprobación de transferencia' : 'Práctica recomendada'}</p>
        <ActivityView key={`${packageKey(currentPackage)}:${standalone.id}:${selected?.group}`} pack={currentPackage} activity={standalone}
          accountId={accountId} deviceId={deviceId} events={history.events} record={record} newAttemptGroupId={selected?.group}
          diagnostic={diagnosticIndex >= 0} afterAnswer={proposalAction ?? diagnosticAction} />
      </article> : currentSession ? <GuidedSessionView key={`${packageKey(currentPackage)}:session:${currentSession.id}`} pack={currentPackage} session={currentSession}
        accountId={accountId} deviceId={deviceId} events={history.events} record={record} openMaterial={openMaterial} initialPosition={sessionPosition}
        onPosition={position => setSelected(current => current?.pack === packageKey(currentPackage) && current.session === currentSession.id
          ? { ...current, positionId: position.id } : current)}
        afterSession={proposalAction && <button className="button primary" onClick={proposalAction.run}>{proposalAction.label} <ArrowRight size={17} /></button>}
        renderActivity={(activity, referenceVisible, afterAnswer, assessment) => <ActivityView key={activity.id} pack={currentPackage} activity={activity} accountId={accountId}
          deviceId={deviceId} events={history.events} record={record} referenceVisible={referenceVisible} assessment={assessment} afterAnswer={afterAnswer} />} />
      : currentLesson && <LessonView key={JSON.stringify([packageKey(currentPackage), currentLesson.id, selected?.proposal])} pack={currentPackage} lesson={currentLesson}
        accountId={accountId} deviceId={deviceId} events={history.events} record={record} openMaterial={openMaterial}
        initialActivityId={selected?.activity} onActivityChange={activity => setSelected(current => current?.pack === packageKey(currentPackage)
          && current.lesson === currentLesson.id ? { ...current, activity } : current)}
        nextLesson={nextLesson ? { label: 'Siguiente lección', run: () => openLesson(nextLesson.pack, nextLesson.lesson, lessonTopic) }
          : nextTopic ? { label: 'Siguiente tema', run: () => navigation.navigate({ section: 'map', topic: nextTopic.id }, true) }
            : { label: 'Volver al temario', run: returnFromStudy }}
        proposalAction={proposalAction} />}
    </> : ready && <>
      {section === 'map' && !mapTopic && (resumeSession || resumeDestination || startingTopic) && <section className="lab-resume-card" aria-label="Continuar estudio">
        <div>
          <p className="lab-resume-context">{resumeSession ? 'Sesión guardada' : resumeDestination ? resumeTopic ? `Continuar estudio · ${resumeTopic}` : 'Continuar estudio' : `Punto de partida · ${startingTopic?.id}`}</p>
          <h2>{resumeSession?.session.title ?? resumeDestination?.lesson.title ?? startingTopic?.title}</h2>
          {resumeLesson && <p>Actividad {resumeLesson.activityIndex + 1} de {resumeLesson.lesson.activityIds.length}</p>}
        </div>
        {resumeSession ? <button className="button primary" onClick={() => openLocation({ pack: packageKey(resumeSession.pack),
          session: resumeSession.session.id, positionId: resumeSession.position.id })}>Reanudar sesión guiada</button>
          : resumeReading ? <button className="button primary" onClick={() => {
            try { sessionStorage.setItem(activityLocationKey(accountId, resumeReading.pack, resumeReading.lesson) + ':pane', 'read') }
            catch { /* A lesson without an explicit activity opens in reading. */ }
            openLesson(resumeReading.pack, resumeReading.lesson, resumeTopic)
          }}>Continuar lectura</button> : resumeLesson ? <button className="button primary" onClick={() => openLocation({ pack: packageKey(resumeLesson.pack),
            lesson: resumeLesson.lesson.id, activity: resumeLesson.activity.id, topic: resumeTopic })}>Reanudar actividad</button>
            : <button className="button primary" onClick={() => navigation.navigate({ section: 'map', topic: startingTopic?.id })}>Empezar tema</button>}
      </section>}
      {section === 'map' && !hasCatalogue && <section className="lab-empty" aria-labelledby="lab-start-title">
        <h2 id="lab-start-title">Empieza a estudiar</h2>
        <p>Carga tu catálogo de Drive o instala los archivos de la carpeta Paquetes.</p>
        <div className="lab-actions">{catalogueLoad}{installButton}
          {!connected && <button className="button primary" disabled={!canConnect} onClick={reconnect}>Reconectar</button>}
        </div>
      </section>}
      {section === 'review' && <section className="lab-section-content">
        <h2 tabIndex={-1} data-study-heading>Repaso</h2>
        {learning.snapshot && queue && hasCatalogue && <LearningDashboard snapshot={learning.snapshot} queue={queue} initialTopic={mapTopic}
          open={proposal => openRecommendation(proposal.target, proposal.id)} skip={id => setSkippedProposals(current => [...current, id])}
          reset={() => setSkippedProposals([])} />}
        {learning.snapshot && hasCatalogue && <TopicLearning snapshot={learning.snapshot} topic={mapTopic} />}
        <InitialDiagnostic targets={targets} events={history.events} open={target => { setShowDiagnostic(false); openRecommendation(target) }}
          showResults={showDiagnostic} summaryRef={diagnosticSummary} />
        {learning.error && <p role="status">No se pudo calcular el progreso de aprendizaje. Tus respuestas siguen guardadas.</p>}
        {sessionsFor()}
        {!hasCatalogue && <p>Carga el catálogo para preparar tus repasos.</p>}
      </section>}
      {section === 'exams' && <section className="lab-section-content">
        <h2 tabIndex={-1} data-study-heading>Exámenes</h2>
        <ExamCatalog packages={packages} events={history.events} accountId={accountId} mode="exams"
          open={(pack, form, examRun) => openLocation({ pack: packageKey(pack), exam: form.id, examRun })} />

      </section>}
      {section === 'settings' && <div className="lab-section-content lab-settings">
        <button className="text-link lab-context-back" onClick={closeSettings}><ArrowLeft size={16} aria-hidden="true" /> Volver al estudio</button>
        <h2 tabIndex={-1} data-study-heading>Ajustes del Laboratorio</h2>
        <section aria-label="Cuenta y sincronización">
          <h3>Cuenta y sincronización</h3>
          <div className="lab-actions">{!connected && <button className="button primary" disabled={!canConnect} onClick={reconnect}>Reconectar</button>}
            <button className="button" disabled={!sync || !connected} onClick={() => void sync?.refresh().catch(() => {})}><RefreshCw size={16} /> Sincronizar progreso</button></div>
        </section>
        <section aria-label="Catálogo">
          <h3>Catálogo</h3>
          <div className="lab-actions">{catalogueLoad}{installButton}</div>
          <label>Importar paquete privado validado<input type="file" accept="application/json,.json" multiple disabled={!loaded || busy} onChange={event => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            void installFiles(files, false)
          }} /></label>
        </section>
        <section aria-label="Sin conexión">
          <h3>Sin conexión</h3>
          <OfflineControls needsSql={packages.some(p => p.activities.some(a => a.kind === 'sql'))}
            needsPython={packages.some(p => p.activities.some(a => a.kind === 'code' && a.language === 'python'))} />
        </section>
        <section aria-label="Copia del progreso">
          <h3>Copia del progreso</h3>
          <button className="button" disabled={!sync || !loaded} onClick={() => download('laboratorio-progreso.json', exportHistory(accountId, history.events))}><Download size={16} /> Exportar progreso</button>
          <label>Restaurar progreso de esta cuenta<input type="file" accept="application/json,.json" onChange={async event => {
            const file = event.currentTarget.files?.[0]; if (!file || !sync) return
            try {
              if (file.size > 32 * 1024 ** 2) throw new Error('La copia supera 32 MB.')
              await record(restoreHistory(accountId, await readText(file), history.events)); setError('')
            } catch (failure) { setError(message(failure)) }
            finally { event.target.value = '' }
          }} /></label>
          <button className="button danger-text" disabled={!connected || !sync || busy} onClick={() => setResetOpen(true)}>Reiniciar historial</button>
        </section>
      </div>}
    </>}
    {ready && <div hidden={section !== 'map' || isStudying}>
      <StudyMap packages={packages} events={history.events} accountId={accountId}
        active={section === 'map' && !isStudying} topicId={mapTopic} defaultTopicId={resumeTopic ?? startingTopic?.id}
        onTopicChange={topic => topic ? navigation.navigate({ section: 'map', topic }, !!mapTopic) : navigation.close({ section: 'map' })}
        openLesson={openLesson} topicExtras={topic => <>
          <ExamCatalog packages={packages} events={history.events} accountId={accountId} topicId={topic}
            open={(pack, form, examRun) => openLocation({ pack: packageKey(pack), exam: form.id, examRun })} />
          {sessionsFor(topic)}
          {learning.snapshot && <TopicLearning snapshot={learning.snapshot} topic={topic} />}
          <button className="text-link" onClick={() => navigation.navigate({ section: 'review', topic })}>Repasar este tema</button>
        </>} />
    </div>}
    </div>
    {resetOpen && <Dialog title="Reiniciar historial del laboratorio" onClose={() => { if (!resetting) setResetOpen(false) }}>
      <p>Empieza de cero en los dispositivos que sincronizan esta cuenta. Las respuestas, los borradores, las notas y los exámenes anteriores quedan fuera del historial activo.</p>
      <p>Si quieres conservar una copia, expórtala antes de reiniciar.</p>
      {error && <p role="alert">{error}</p>}
      <div className="lab-actions">
        <button className="button" disabled={resetting} onClick={() => setResetOpen(false)}>Cancelar</button>
        <button className="button danger" disabled={resetting} onClick={() => void resetHistory()}>{resetting ? 'Reiniciando…' : 'Empezar de cero'}</button>
      </div>
    </Dialog>}
  </>
}

export function LessonView({ pack, lesson, accountId, deviceId, events, record, openMaterial, initialActivityId, onActivityChange, nextLesson, proposalAction }: {
  pack: LabPackage; lesson: Lesson; accountId: string; deviceId: string; events: LabEvent[];
  record: (events: LabEvent[]) => Promise<void>; openMaterial: (resourceId: string, sectionId: string) => void
  initialActivityId?: string; onActivityChange?: (activityId: string) => void
  nextLesson?: StudyAction; proposalAction?: StudyAction
}) {
  const activities = useMemo(() => lesson.activityIds.flatMap(id => pack.activities.find(a => a.id === id) ?? []), [lesson, pack])
  const positionKey = activityLocationKey(accountId, pack, lesson)
  const [index, setIndex] = useState(() => {
    const explicit = activities.findIndex(activity => activity.id === initialActivityId)
    if (explicit >= 0) return explicit
    try {
      const value = Number(sessionStorage.getItem(positionKey))
      return Number.isSafeInteger(value) && value >= 0 && value < activities.length ? value : 0
    } catch { return 0 }
  })
  const [reading, setReading] = useState(() => {
    try {
      const pane = sessionStorage.getItem(positionKey + ':pane')
      if (pane === 'practice' || pane === 'read') return pane === 'read'
    } catch { /* The destination determines the initial stage. */ }
    return !initialActivityId
  })
  const [indexOpen, setIndexOpen] = useState(false)
  const [referenceOpen, setReferenceOpen] = useState(false)
  const readingPosition = useRef<number>(0)
  const questionPosition = useRef<number>(0)
  const initialReadingRestore = useRef(true)
  const explanation = useRef<HTMLElement>(null)
  const practice = useRef<HTMLElement>(null)
  const activity = activities[index]
  const phase = activity?.phase === 'practice' ? 'practice' : 'check'
  const stage = reading ? 'read' : phase
  const hasReadingIndex = lesson.explanation.length + lesson.workedExample.length >= 5
  const readingContent = (isReference = false) => <LearningReading onReady={isReference ? undefined : restoreReading} pack={pack} lesson={lesson} accountId={accountId} deviceId={deviceId} events={events} record={record}>
    {!isReference && hasReadingIndex && <details className="lab-reading-index"><summary>Secciones de la lectura</summary>
      <ol>{[...lesson.explanation.map(part => part.title), ...(lesson.workedExample.length ? ['Ejemplo resuelto'] : [])].map((title, index) =>
        <li key={index}><button type="button" className="text-link" onClick={() => focusStudyHeading(explanation.current?.querySelectorAll<HTMLElement>('[data-reading-section]')[index])}>{title}</button></li>)}</ol>
    </details>}
    {lesson.explanation.map((part, i) => <section key={i}><h3 tabIndex={isReference ? undefined : -1} data-reading-section>{part.title}</h3><StudyText text={part.body} /></section>)}
    {lesson.workedExample.length > 0 && <div className="lab-example"><h3 tabIndex={isReference ? undefined : -1} data-reading-section>Ejemplo resuelto</h3>
      {lesson.workedExample.map((part, i) => <section key={i}><h4>{part.title}</h4><StudyText text={part.body} /></section>)}</div>}
    <button className="button lab-material-link" onClick={event => {
      event.currentTarget.focus({ preventScroll: true })
      openMaterial(lesson.material.resourceId, lesson.material.sectionId)
    }}><BookOpen size={17} aria-hidden="true" /> Consultar material completo</button>
  </LearningReading>

  useEffect(() => {
    try {
      sessionStorage.setItem(positionKey, String(index))
      sessionStorage.setItem(positionKey + ':pane', reading ? 'read' : 'practice')
    } catch { /* Durable answers remain available. */ }
  }, [index, reading, positionKey])

  function chooseActivity(next: number, moveFocus = true) {
    const target = activities[next]
    if (!target) return
    setIndex(next)
    setReading(false)
    setReferenceOpen(false)
    setIndexOpen(false)
    onActivityChange?.(target.id)
    if (moveFocus) requestAnimationFrame(() => focusStudyHeading(practice.current?.querySelector<HTMLElement>('[data-study-heading]')))
  }

  function restoreReading() {
    let top = readingPosition.current
    if (initialReadingRestore.current) {
      initialReadingRestore.current = false
      try { top = Number(localStorage.getItem(positionKey + ':read-top') ?? sessionStorage.getItem(positionKey + ':read-top')) || 0 }
      catch { /* The reading starts at its title. */ }
    }
    readingPosition.current = top
    if (top > 0) window.scrollTo({ top, behavior: 'instant' })
    try { localStorage.setItem(readingLocationKey(accountId), JSON.stringify({ pack: pack.id, version: pack.version, lesson: lesson.id, savedAt: new Date().toISOString() })) }
    catch { /* Reading remains available without device storage. */ }
  }
  useEffect(() => {
    if (!reading) return
    const remember = () => {
      readingPosition.current = window.scrollY
      try { localStorage.setItem(positionKey + ':read-top', String(window.scrollY)) }
      catch { /* The position is still kept while this lesson is mounted. */ }
    }
    window.addEventListener('scroll', remember, { passive: true })
    return () => {
      window.removeEventListener('scroll', remember)
    }
  }, [reading, positionKey])

  const [rememberedStages, setRememberedStages] = useState<Partial<Record<'practice' | 'check', number>>>({})
  function chooseStage(next: 'read' | 'practice' | 'check') {
    if (stage === next) return
    if (!reading && activity) {
      questionPosition.current = window.scrollY
      setRememberedStages(saved => ({ ...saved, [phase]: index }))
    }
    if (next === 'read') {
      setReferenceOpen(false)
      setReading(true)
      requestAnimationFrame(() => {
        if (readingPosition.current > 0) explanation.current?.focus({ preventScroll: true })
        else focusStudyHeading(explanation.current)
      })
    } else {
      const restoreQuestion = reading && phase === next && questionPosition.current > 0
      chooseActivity(phase === next ? index : rememberedStages[next] ?? activities.findIndex(a => (a.phase === 'practice') === (next === 'practice')), !restoreQuestion)
      if (restoreQuestion) requestAnimationFrame(() => {
        practice.current?.querySelector<HTMLElement>('[data-study-heading]')?.focus({ preventScroll: true })
        window.scrollTo({ top: questionPosition.current, behavior: 'instant' })
      })
    }
  }

  const answered = new Set(events.filter((event): event is Attempt => event.kind === 'attempt' && event.accountId === accountId
    && event.packageId === pack.id && event.packageVersion === pack.version && event.outcome !== 'omitted'
    && activities.some(a => a.id === event.activityId && a.version === event.activityVersion)).map(event => event.activityId))
  const pending = activities.findIndex(a => !answered.has(a.id))
  const previous = index > 0 ? { label: 'Anterior', run: () => chooseActivity(index - 1) } : undefined
  const next = index < activities.length - 1 ? { label: 'Siguiente actividad', run: () => chooseActivity(index + 1) } : undefined
  const afterAnswer = pending >= 0 ? { label: 'Ir a la primera pendiente', run: () => chooseActivity(pending) } : nextLesson
  const stages = [
    ['read', 'Leer', true],
    ['practice', 'Practicar', activities.some(a => a.phase === 'practice')],
    ['check', 'Comprobar', activities.some(a => a.phase !== 'practice')],
  ] as const

  return <article className="lab-session lab-linear-lesson">
    <header className="lab-lesson-heading">
      <h2 tabIndex={-1} data-study-heading>{lesson.title}</h2>
      <p>{lesson.minutes} min de lectura</p>
      <span>{answered.size} de {activities.length} actividades respondidas</span>
    </header>
    <div className="lab-linear-stages" role="group" aria-label="Etapas de la lección">
      {stages.filter(([, , visible]) => visible).map(([id, label]) =>
        <button key={id} type="button" aria-pressed={stage === id} onClick={() => chooseStage(id)}>{label}</button>)}
    </div>
    {reading && <section ref={explanation} tabIndex={-1} aria-label="Explicación y ejemplo" className="lab-explanation lab-linear-reading">
      {readingContent()}
      {activities.length > 0 && <button className="button primary lab-start-practice" onClick={() => chooseStage(phase)}>
        {phase === 'practice' ? 'Empezar a practicar' : 'Ir a la comprobación'} <ArrowRight size={17} aria-hidden="true" />
      </button>}
    </section>}
    {!reading && activity && <div className={referenceOpen ? 'lab-linear-work with-reference' : 'lab-linear-work'}>
      <section ref={practice} className="lab-practice lab-linear-practice" aria-label={phase === 'practice' ? 'Práctica' : 'Comprobación'}>
        <div className="lab-activity-position"><span>Actividad {index + 1} de {activities.length}</span>
          <button className="text-link" onClick={event => { event.currentTarget.focus(); setIndexOpen(true) }}>Ver actividades</button>
        </div>
        <ActivityView key={activity.id} activity={activity} pack={pack} accountId={accountId}
          deviceId={deviceId} events={events} record={record} referenceVisible={referenceOpen}
          consultReference={() => setReferenceOpen(true)}
          previous={previous} next={next} afterAnswer={afterAnswer} proposalAction={proposalAction} />
      </section>
      {referenceOpen && <LessonReference close={() => setReferenceOpen(false)}>{readingContent(true)}</LessonReference>}
    </div>}
    {indexOpen && <Dialog title="Actividades de la lección" className="lab-study-dialog" preserveScroll
      onClose={() => setIndexOpen(false)}>
      <ol className="lab-activity-index">{activities.map((item, i) => <li key={item.id}>
        <button className="lab-study-row" aria-current={i === index ? 'step' : undefined} onClick={() => chooseActivity(i)}>
          <span><strong>{i + 1}. {item.phase === 'practice' ? item.title : 'Comprobación'}</strong>
            <small>{i === index ? 'Actual · ' : ''}{answered.has(item.id) ? 'Respondida' : 'Pendiente'}</small></span>
        </button>
      </li>)}</ol>
    </Dialog>}
  </article>
}

function LessonReference({ close, children }: { close: () => void; children: React.ReactNode }) {
  const mobile = useSyncExternalStore(subscribeCompact, compact)
  const returnButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (!mobile) returnButton.current?.focus({ preventScroll: true })
  }, [mobile])
  return mobile ? <Dialog title="Explicación" closeLabel="Volver a la actividad" showCloseLabel
    className="lab-study-dialog" preserveScroll onClose={close}>{children}</Dialog>
    : <aside className="lab-linear-reference" aria-label="Explicación">
      <div className="lab-reference-head"><h3>Explicación</h3>
        <button ref={returnButton} className="text-link" onClick={() => { close(); requestAnimationFrame(() => document.querySelector<HTMLElement>('.lab-reference-trigger')?.focus({ preventScroll: true })) }}>Volver a la actividad</button></div>
      {children}
    </aside>
}

const compact = () => matchMedia('(max-width: 899px)').matches
function subscribeCompact(changed: () => void) {
  const query = matchMedia('(max-width: 899px)')
  query.addEventListener('change', changed)
  return () => query.removeEventListener('change', changed)
}

export function ActivityView({ activity, pack, accountId, deviceId, events, record, newAttemptGroupId, referenceVisible = false,
  diagnostic = false, assessment = false, previous, next, afterAnswer, proposalAction, consultReference }: {
  activity: Activity; pack: LabPackage; accountId: string; deviceId: string; events: LabEvent[];
  record: (events: LabEvent[]) => Promise<void>; newAttemptGroupId?: string; referenceVisible?: boolean
  diagnostic?: boolean; assessment?: boolean; previous?: StudyAction; next?: StudyAction; afterAnswer?: StudyAction; proposalAction?: StudyAction
  consultReference?: () => void
}) {
  const ref = { activityId: activity.id, activityVersion: activity.version, packageId: pack.id, packageVersion: pack.version }
  const buffer = draftWriteBuffer(accountId, ref)
  const semantic = semanticWriteBuffer(accountId, ref)
  const semanticEntries = useSyncExternalStore(semantic.subscribe, semantic.snapshot)
  const semanticBlocked = semanticEntries.some(entry => entry.status !== 'saved')
  useEffect(() => { semantic.acknowledge(events) }, [semantic, events])
  const buffered = useSyncExternalStore(buffer.subscribe, buffer.snapshot)
  useEffect(() => { buffer.acknowledge(events) }, [buffer, events])
  const eventSnapshot = useRef(events)
  eventSnapshot.current = events
  const [capture] = useState(() => new LearningCapture(accountId, deviceId, () => [...eventSnapshot.current, ...semantic.events()]))
  const key = JSON.stringify([pack.id, pack.version, activity.id, activity.version])
  const currentHeads = () => draftHeads(mergeEvents(accountId, eventSnapshot.current, buffer.events()), key)
  const revisions = useMemo(() => {
    try { return { heads: currentHeads(), error: '' } }
    catch (failure) { return { heads: draftHeads(buffered.map(entry => entry.note), key), error: message(failure) } }
  }, [events, buffered, accountId, key])
  const [startingNew] = useState(() => !!newAttemptGroupId && !revisions.heads.some(head => head.attemptGroupId === newAttemptGroupId))
  const [initialized, setInitialized] = useState(!startingNew)
  const heads = initialized ? revisions.heads : []
  const failed = buffered.filter(entry => entry.status === 'failed')
  const pending = buffered.some(entry => entry.status === 'pending')
  const initialValue = activity.kind === 'choice' ? '' : activity.kind === 'ipv4-model' ? serializeIPv4View(createIPv4View(activity))
    : activity.kind === 'signal-model' ? '[]' : isPredictionActivity(activity) ? '{}'
      : activity.kind === 'html-css' ? JSON.stringify(activity.starter) : activity.starter
  const [initial] = useState<Draft>(() => {
    const queued = semantic.events().find((event): event is Draft => event.kind === 'draft' && !!newAttemptGroupId
      && event.attemptGroupId === newAttemptGroupId && event.packageId === pack.id && event.packageVersion === pack.version
      && event.activityId === activity.id && event.activityVersion === activity.version)
    if (queued) return queued
    return { ...ref, id: crypto.randomUUID(), kind: 'draft', deviceId, accountId,
    createdAt: new Date().toISOString(), attemptGroupId: newAttemptGroupId ?? heads[0]?.attemptGroupId ?? crypto.randomUUID(),
    parentIds: startingNew ? revisions.heads.map(head => head.id) : [], value: initialValue, position: 0,
    ...(activity.kind === 'ipv4-model' ? { valueFormat: 'ipv4-model-v1' as const } : {}) }
  })
  const answer = heads.length === 1 ? heads[0].value : initialValue
  const groupId = heads.length === 1 ? heads[0].attemptGroupId : initial.attemptGroupId
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [caseOpen, setCaseOpen] = useState(false)
  const [hintOpen, setHintOpen] = useState<number>()
  const hintHistory = useRef<HTMLElement>(null)
  const caseContent = useRef<HTMLDivElement>(null)
  const casePosition = useRef(0)
  useLayoutEffect(() => {
    if (caseOpen && caseContent.current) caseContent.current.scrollTop = casePosition.current
  }, [caseOpen])
  const feedbackPanel = useRef<HTMLDivElement>(null)
  const focusFeedback = useRef(false)
  const checkingChoice = useRef(false)
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
  const forward = next ?? (latest ? afterAnswer : undefined)
  const nextProposal = latest ? proposalAction : undefined
  useEffect(() => {
    if (busy || !latest || !focusFeedback.current) return
    focusFeedback.current = false
    const feedback = feedbackPanel.current
    feedback?.focus({ preventScroll: true })
    feedback?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }, [busy, latest])
  const latestEvidence = useMemo(() => {
    if (!latest || activity.state !== 'validated') return undefined
    try { return deriveLearning({ accountId, packages: [pack], events, now: new Date().toISOString(), policy: DEFAULT_LEARNING_POLICY })
      .attempts.find(attempt => attempt.attemptId === latest.id) }
    catch { return undefined }
  }, [accountId, activity.state, pack, events, latest])
  const [clock] = useState(() => new ActiveTime(performance.now(), document.visibilityState === 'visible'))
  useEffect(() => {
    const update = () => clock.visibility(performance.now(), document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [clock])
  const activeMs = () => clock.take(performance.now(), document.visibilityState === 'visible')
  const learningTarget = () => ({ ...ref, kind: 'activity' as const, attemptGroupId: groupId })
  const predictionId = activity.kind === 'ipv4-model' ? parseIPv4View(answer).predictionId : null
  const [presentation] = useState(() => capture.present(learningTarget(), activity,
    predictionId, { referenceVisible }))
  useEffect(() => {
    if (semantic.hasUnsaved()) return
    const batch = [...(heads.length ? [] : [initial]), ...presentation.events]
    if (!batch.length) { setInitialized(true); return }
    void semantic.save(batch[0], incoming => capture.write(incoming, record), batch.slice(1))
      .then(saved => { if (saved) setInitialized(true) })
  }, []) // The immutable initial batch is reused if React replays this effect.
  useEffect(() => {
    if (!referenceVisible || semantic.hasUnsaved()) return
    const known = new Set([...eventSnapshot.current, ...semantic.events()].map(event => event.id))
    const batch = capture.reference(learningTarget(), activity, predictionId).filter(event => !known.has(event.id))
    if (batch.length) void semantic.save(batch[0], incoming => capture.write(incoming, record), batch.slice(1))
  }, [referenceVisible, groupId, predictionId, semanticEntries])
  const requestedGroupSaved = () => !!newAttemptGroupId && [...eventSnapshot.current,
    ...semantic.snapshot().filter(entry => entry.status === 'saved').flatMap(entry => [entry.note, ...(entry.companions ?? [])])]
    .some(event => event.kind === 'draft' && event.attemptGroupId === newAttemptGroupId && event.packageId === pack.id
      && event.packageVersion === pack.version && event.activityId === activity.id && event.activityVersion === activity.version)
  useEffect(() => {
    if (!startingNew || initialized) return
    if (requestedGroupSaved()) { setInitialized(true); return }
    if (semantic.hasUnsaved()) return
    // A previous group's pending write can finish after this view has mounted.
    const batch = [initial, ...presentation.events]
    void semantic.save(batch[0], incoming => capture.write(incoming, record), batch.slice(1))
      .then(saved => { if (saved) setInitialized(true) })
  }, [events, semanticEntries, startingNew, initialized])
  async function retrySemantic() {
    semantic.retry(incoming => capture.write(incoming, record))
    if (!await semantic.flush()) return
    if (startingNew && !requestedGroupSaved()) {
      const batch = [initial, ...presentation.events]
      if (!await semantic.save(batch[0], incoming => capture.write(incoming, record), batch.slice(1))) return
    }
    setInitialized(true); setError('')
  }
  async function recordStudy(facts: LabEvent[]) {
    if (!await semantic.flush()) throw new Error('Guarda primero la respuesta o consulta pendiente.')
    const batch = capture.prepare(learningTarget(), activity, facts, null, { referenceVisible })
    if (!await semantic.save(batch[0], incoming => capture.write(incoming, record), batch.slice(1))) {
      throw new Error('La respuesta o consulta sigue pendiente. Reintenta su guardado antes de continuar.')
    }
  }
  async function save(value: string, companions: LabEvent[] = []) {
    const parents = currentHeads()
    if (parents.length > 1) throw new Error('Elige qué borrador continuar antes de editar.')
    if (parents[0]?.value !== value || companions.length) {
      const draft: Draft = { ...initial, id: crypto.randomUUID(), createdAt: new Date().toISOString(), value,
        attemptGroupId: parents[0]?.attemptGroupId ?? initial.attemptGroupId, parentIds: (parents.length ? parents : [initial]).map(d => d.id) }
      // Begin every local transaction immediately; navigation may close this controller afterward.
      const previousPrediction = companions.find(event => event.kind === 'ipv4-reveal' || event.kind === 'ipv4-reset')
      const decorated = companions.length ? capture.prepare(learningTarget(), activity, companions,
        previousPrediction && 'predictionId' in previousPrediction ? previousPrediction.predictionId : null, { referenceVisible }) : []
      if (!await buffer.save(draft, batch => capture.write(batch, record), decorated)) throw new Error('El borrador sigue pendiente de guardar. Puedes reintentarlo o descargar una copia.')
    }
    if (!await buffer.flush()) throw new Error('Hay revisiones pendientes de guardar. Reintenta el guardado antes de continuar.')
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await action() } catch (failure) { setError(message(failure)) }
    finally { setBusy(false) }
  }
  async function revealSolution() {
    await recordStudy([{ ...ref, id: crypto.randomUUID(), kind: 'assistance', accountId, deviceId,
      createdAt: new Date().toISOString(), attemptGroupId: groupId, hintCount: assistance.hintCount, solutionViewed: true },
    { id: crypto.randomUUID(), kind: 'exposure', accountId, deviceId, createdAt: new Date().toISOString(),
      familyId: activity.familyId, reason: 'solution' }])
  }
  async function submitChoice(value: string | null) {
    if (activity.kind !== 'choice') return
    if (!await buffer.flush()) throw new Error('Guarda el borrador antes de comprobar la respuesta.')
    const result = gradeChoice(activity, value)
    await recordStudy([{ ...ref, id: crypto.randomUUID(), kind: 'attempt', deviceId, accountId, createdAt: new Date().toISOString(),
      familyId: activity.familyId, objectiveIds: activity.objectiveIds, attemptGroupId: groupId,
      answer: value, ...result, ...attemptFacts(), activeMs: activeMs(), phase: activity.phase, gradingVersion: 'choice-v1' }])
    focusFeedback.current = true
  }
  function checkChoice(value: string | null) {
    if (checkingChoice.current || busy || semanticBlocked || heads.length !== 1 || failed.length) return
    checkingChoice.current = true
    void run(() => submitChoice(value)).finally(() => { checkingChoice.current = false })
  }
  async function submitModel(value: string, correct: boolean, feedback: string) {
    await recordStudy([{ ...ref, id: crypto.randomUUID(), kind: 'attempt', deviceId, accountId, createdAt: new Date().toISOString(),
      familyId: activity.familyId, objectiveIds: activity.objectiveIds, attemptGroupId: groupId,
      answer: value, outcome: correct ? 'correct' : 'incorrect', ...attemptFacts(), activeMs: activeMs(),
      phase: activity.phase, gradingVersion: activity.mode.version, feedback }])
  }
  function draftLabel(value: string, index: number) {
    if (isPredictionActivity(activity)) {
      const schema = predictionFor(activity)
      const draft = parsePredictionDraft(value, schema.controls, schema.describe)
      const controls = schema.controls.map((control, i) =>
        `${control.label}: ${control.toggle ? draft.controls[i] === '1' ? 'sí' : 'no' : draft.controls[i]}`)
      return `Versión ${index + 1}. ${controls.join(' · ')}. Predicción: ${draft.answers.map(item => item || 'sin responder').join(' · ')}.`
    }
    if (activity.kind !== 'ipv4-model') return value || 'Sin respuesta'
    try {
      const view = parseIPv4View(value)
      const phase = { editing: 'en edición', predicted: 'predicción guardada', revealed: 'cálculo consultado' }[view.phase]
      const contexts: Record<string, string> = { numeric: 'solo numérico', conventional: 'subred convencional', 'p2p-compatible': 'enlace /31 compatible' }
      const context = contexts[view.input.context] ?? 'contexto pendiente'
      return `Versión ${index + 1}: ${view.input.address}, ${view.input.format === 'prefix' ? '/' : 'máscara '}${view.input.value}; ${context}; prueba ${view.input.probe || 'vacía'}; ${phase}. Predicción: ${view.prediction.lower || 'sin límite inferior'}–${view.prediction.upper || 'sin límite superior'}, pertenencia ${view.prediction.member === 'yes' ? 'dentro' : view.prediction.member === 'no' ? 'fuera' : 'sin responder'}.${view.prediction.interpretationNote ? ' Nota: ' + view.prediction.interpretationNote : ''}`
    } catch { return `Versión ${index + 1}: copia conservada para revisión` }
  }
  const showNeutralHeading = diagnostic || assessment || activity.phase !== 'practice'
  const leadingQuestion = /^¿[^\n]{1,120}\?\s*\n/.exec(activity.prompt)
  const heading = showNeutralHeading ? leadingQuestion?.[0].trim() ?? 'Enunciado' : activity.title
  const prompt = leadingQuestion?.[0].trim() === heading ? activity.prompt.slice(leadingQuestion[0].length) : activity.prompt
  const longCase = prompt.length > 650
  const hasCase = activity.mode.kind === 'documentary' || longCase
  const finalQuestion = longCase && /(?:^|\n\s*\n)(¿[^\n]+\?)\s*$/.exec(prompt)
  const checkDisabled = busy || semanticBlocked || heads.length !== 1 || failed.length > 0
  const showStudyTools = !showNeutralHeading
  return <div className="lab-activity">
    <h3 tabIndex={-1} data-study-heading>{heading}</h3>
    {capture.warning && <p role="status">{capture.warning}</p>}
    {semanticEntries.some(entry => entry.status === 'failed') && <section aria-label="Guardado de respuesta y ayuda">
      <p role="status">Hay una respuesta o consulta pendiente de guardar.</p>
      {semanticEntries.some(entry => entry.status === 'failed') && <>
        <p role="alert">{semanticEntries.find(entry => entry.status === 'failed')?.error} El lote original sigue en esta pestaña. Reintenta o descarga una copia antes de cerrarla.</p>
        <div className="lab-actions"><button className="button" disabled={semanticEntries.some(entry => entry.status === 'pending')}
          onClick={() => void retrySemantic()}>Reintentar guardar respuesta y ayuda</button>
          <button className="button" onClick={() => download('laboratorio-respuesta-pendiente.json', exportHistory(accountId, semantic.events()))}>Descargar respuesta pendiente</button></div>
      </>}
    </section>}

    {(!longCase || finalQuestion) && <div className="lab-prompt"><StudyText text={finalQuestion ? finalQuestion[1] : prompt} /></div>}
    {hasCase && <button className="text-link lab-case-trigger"
      onClick={event => { event.currentTarget.focus(); setCaseOpen(true) }}>Ver caso</button>}
    {caseOpen && <Dialog title="Enunciado del caso" closeLabel="Volver a la pregunta" showCloseLabel wide preserveScroll
      className="lab-study-dialog" onClose={() => {
        casePosition.current = caseContent.current?.scrollTop ?? 0
        setCaseOpen(false)
      }}>
      <div className="lab-case-content" ref={caseContent} role="region" aria-label="Texto del caso" tabIndex={0}>
        <StudyText text={prompt} />
      </div>
    </Dialog>}
    {consultReference && <button className="text-link lab-reference-trigger"
      aria-expanded={referenceVisible} aria-describedby={referenceVisible ? undefined : `lab-reference-impact-${activity.id}`}
      onClick={event => { event.currentTarget.focus(); consultReference() }}>Consultar explicación</button>}
    {consultReference && !referenceVisible && <span id={`lab-reference-impact-${activity.id}`} className="lab-reference-impact">
      Si la abres antes de comprobar, contará como apoyo.
    </span>}
    {referenceVisible && <p className="lab-reading-support"><BookOpen size={16} aria-hidden="true" /> Explicación disponible · Práctica con apoyo</p>}
    {(failed.length > 0 || (pending && activity.kind !== 'choice')) && <section aria-label="Guardado del borrador">
      <p role="status">{pending ? 'Guardando borrador…' : 'Borrador pendiente de guardar.'}</p>
      {failed.length > 0 && <><p role="alert">{failed[0].error} El texto sigue disponible en esta pestaña. {failed.some(entry => entry.collision)
        ? 'Guarda una copia antes de cerrarla.' : 'Reintenta el guardado antes de cerrarla.'}</p>
        <div className="lab-actions"><button className="button" disabled={pending || failed.every(entry => entry.collision)} onClick={() => {
          buffer.retry(record)
          void buffer.flush().then(saved => { if (saved) setError('') })
        }}>Reintentar guardar borrador</button>
          <button className="button" onClick={() => download('laboratorio-borradores-pendientes.json', exportHistory(accountId, buffer.events()))}>Guardar copia del borrador pendiente</button></div></>}
    </section>}
    {revisions.error ? <div role="alert"><p>{revisions.error}</p><label>Borrador pendiente<textarea readOnly rows={8} value={answer} /></label></div>
      : heads.length > 1 ? <div role="alert"><h4>Hay dos borradores de esta actividad</h4>
      <p>Elige cuál continuar. Las versiones anteriores se conservarán en el historial.</p>
      {heads.map((head, index) => <button className="button lab-draft-option" key={head.id} disabled={busy || pending || failed.length > 0} onClick={() => void run(async () => {
        const resolved = { ...head, id: crypto.randomUUID(), deviceId, createdAt: new Date().toISOString(), parentIds: heads.map(d => d.id) }
        if (!await buffer.save(resolved, record)) throw new Error('La elección del borrador sigue pendiente de guardar.')
      })}>Continuar: {draftLabel(head.value, index)}</button>)}
    </div> : activity.kind === 'choice' ? <>
      <fieldset className="lab-answer-options" disabled={heads.length === 0}><legend>Elige una respuesta</legend>
        {activity.options.map((option, index) => <label key={option.id} className="lab-option"><input type="radio" name={activity.id}
          value={option.id} checked={answer === option.id} aria-disabled={busy || semanticBlocked || undefined} onChange={() => {
            if (checkingChoice.current || busy || semanticBlocked) return
            setError('')
            void save(option.id).catch(failure => setError(message(failure)))
          }} /><span className="lab-option-letter" aria-hidden="true">{String.fromCharCode(65 + index)}.</span><span>{option.text}</span></label>)}
      </fieldset>
      <div className="lab-actions"><button className="button primary" aria-disabled={checkDisabled || !answer} onClick={() => { if (answer) checkChoice(answer) }}>Comprobar respuesta</button>
        <button className="button" aria-disabled={checkDisabled || latest?.outcome === 'omitted'}
          onClick={() => { if (latest?.outcome !== 'omitted') checkChoice(null) }}>Dejar sin responder</button>
      </div>
      {latest?.kind === 'attempt' && <div className="lab-feedback lab-answer-feedback" tabIndex={-1} ref={feedbackPanel} data-outcome={latest.outcome}>
        {latest.answer !== null && latest.answer !== answer && <small>Última comprobación</small>}
        <div role="status"><strong>{latest.outcome === 'omitted' ? 'Sin respuesta' : latest.outcome === 'correct' ? 'Respuesta correcta' : 'Revisa la respuesta'}{latest.hintCount > 0 || latest.solutionViewed ? ' · Con ayuda' : ''}</strong>
        {latest.feedback && <StudyText text={latest.feedback} />}</div>{latest.outcome !== 'omitted' && <details key={latest.id} onToggle={event => {
          if (event.currentTarget.open && !assistance.solutionViewed) void run(revealSolution)
        }}><summary>Por qué cada opción</summary>{assistance.solutionViewed
          ? activity.options.map(o => <div className="lab-option-explanation" key={o.id}><strong>{o.text}</strong><StudyText text={o.explanation} /></div>)
          : <p>{busy ? 'Guardando la consulta de la explicación…' : 'Guarda la consulta para mostrar las explicaciones.'}
            {!busy && <button className="text-link" onClick={() => void run(() => semantic.hasUnsaved() ? retrySemantic() : revealSolution())}>Reintentar mostrar explicaciones</button>}</p>}</details>}</div>}
    </> : activity.kind === 'ipv4-model' ? <IPv4Panel activity={activity} saved={answer} disabled={heads.length === 0 || busy || semanticBlocked}
      unsaved={pending || failed.length > 0} events={events} context={{ accountId, deviceId, packageId: pack.id, packageVersion: pack.version, attemptGroupId: groupId }}
      takeActiveMs={activeMs} save={save} /> : activity.kind === 'signal-model' ? <SignalPanel activity={activity} saved={answer} latest={latest}
      disabled={heads.length === 0 || busy || semanticBlocked} save={save} onResult={submitModel} />
      : isPredictionActivity(activity) ? <PredictionPanel activity={activity} saved={answer} latest={latest}
        disabled={heads.length === 0 || busy || semanticBlocked} save={save} onResult={submitModel} /> : activity.kind === 'html-css' ? <HtmlPanel activity={activity} saved={answer} disabled={heads.length === 0 || busy || semanticBlocked}
      latest={latest} focusPrompt={<StudyText text={prompt} />} save={save} onResult={async (value, correct, feedback) => {
        await recordStudy([{ ...ref, id: crypto.randomUUID(), kind: 'attempt', deviceId, accountId, createdAt: new Date().toISOString(),
          familyId: activity.familyId, objectiveIds: activity.objectiveIds, attemptGroupId: groupId,
          answer: value, outcome: correct ? 'correct' : 'incorrect', ...attemptFacts(), activeMs: activeMs(),
          phase: activity.phase, gradingVersion: 'html-dom-css-v1', feedback }])
      }} /> : activity.kind === 'code' ? <CodePanel activity={activity} saved={answer} disabled={heads.length === 0 || busy || semanticBlocked}
      latest={latest} focusPrompt={<StudyText text={prompt} />} save={save} onResult={async (value, correct, feedback) => {
        await recordStudy([{ ...ref, id: crypto.randomUUID(), kind: 'attempt', deviceId, accountId, createdAt: new Date().toISOString(),
          familyId: activity.familyId, objectiveIds: activity.objectiveIds, attemptGroupId: groupId,
          answer: value, outcome: correct ? 'correct' : 'incorrect', ...attemptFacts(), activeMs: activeMs(),
          phase: activity.phase, gradingVersion: 'stdout-datasets-v1', feedback }])
      }} /> : <SqlPanel activity={activity} saved={answer} latest={latest} disabled={heads.length === 0 || busy || semanticBlocked}
      focusPrompt={<StudyText text={prompt} />} save={save} onResult={async (value, correct, feedback) => {
        await recordStudy([{ ...ref, id: crypto.randomUUID(), kind: 'attempt', deviceId, accountId, createdAt: new Date().toISOString(),
          familyId: activity.familyId, objectiveIds: activity.objectiveIds, attemptGroupId: groupId,
          answer: value, outcome: correct ? 'correct' : 'incorrect', ...attemptFacts(),
          activeMs: activeMs(), phase: activity.phase, gradingVersion: SQL_GRADING_VERSION,
          feedback: feedback ?? (correct ? 'La consulta satisface los casos comprobados.' : 'La consulta no coincide con el resultado requerido en todos los casos.') }])
      }} />}
    {(previous || forward || nextProposal) && <nav className="lab-activity-navigation lab-answer-navigation" aria-label="Continuar el estudio">
      {previous && <button className="button lab-previous" onClick={previous.run}><ArrowLeft size={17} /> {previous.label}</button>}
      {forward && <button className={latest ? 'button primary' : 'button'} disabled={busy || semanticBlocked} onClick={forward.run}>{forward.label} <ArrowRight size={17} /></button>}
      {nextProposal && <button className={forward ? 'button' : 'button primary'} disabled={busy || semanticBlocked} onClick={nextProposal.run}>{nextProposal.label} <ArrowRight size={17} /></button>}
    </nav>}
    {showStudyTools && activity.kind !== 'ipv4-model' && <details className="lab-prediction"><summary>Anotar una predicción (opcional)</summary>
      <StudyNoteEditor target={{ ...ref, kind: 'activity', purpose: 'prediction' }} accountId={accountId} deviceId={deviceId}
        events={events} record={record} label="Tu predicción" />
    </details>}
    {latest && latest.ordinal > 1 && <p className="lab-mode">Intento {latest.ordinal}. Tu primera respuesta se conserva.</p>}
    {latestEvidence?.referenceSupport === 'recorded' && <p className="lab-mode">Has respondido con la explicación disponible. La respuesta cuenta como práctica con apoyo.</p>}
    {latestEvidence?.referenceSupport === 'uncertain' && <p className="lab-mode">Guardamos la respuesta. Queda por comprobar si puedes resolver el ejercicio sin ayuda.</p>}
    {heads.length === 1 && activity.phase === 'practice' && (showStudyTools || latest) && <>
      <div className="lab-actions">
        {activity.phase === 'practice' && assistance.hintCount < activity.hints.length && <button className="button" disabled={busy || semanticBlocked}
          onClick={event => { event.currentTarget.focus(); void run(async () => { await recordStudy([{ ...ref, accountId, deviceId, id: crypto.randomUUID(), kind: 'assistance',
            attemptGroupId: groupId, createdAt: new Date().toISOString(), hintCount: assistance.hintCount + 1, solutionViewed: assistance.solutionViewed }]); if (compact()) setHintOpen(assistance.hintCount) }) }}>Pista {assistance.hintCount + 1}</button>}
        {activity.phase === 'practice' && !assistance.solutionViewed && <button className="button" disabled={busy || semanticBlocked}
          onClick={() => void run(revealSolution)}>Ver solución</button>}
      </div>
      {assistance.hintCount > 0 && <details className="lab-hint-history" open><summary ref={hintHistory}>Pistas consultadas ({assistance.hintCount})</summary>
        {activity.hints.slice(0, assistance.hintCount).map((hint, i) => <div className="lab-feedback" key={i}><strong>Pista {i + 1}</strong><StudyText text={hint} /></div>)}
      </details>}
      {hintOpen !== undefined && <Dialog title={`Pista ${hintOpen + 1}`} closeLabel="Volver a la actividad" showCloseLabel
        className="lab-study-dialog lab-hint-dialog" preserveScroll onClose={() => { setHintOpen(undefined); requestAnimationFrame(() => hintHistory.current?.focus({ preventScroll: true })) }}>
        <StudyText text={activity.hints[hintOpen] ?? ''} />
      </Dialog>}
      {assistance.solutionViewed && <div className="lab-feedback"><strong>Solución</strong><StudyText text={activity.solution} /></div>}
    </>}
    {error && <p role="alert">{error}</p>}
    {(showStudyTools || latest) && <details className="lab-sources"><summary>Fuentes y límites</summary>
      <p>{activity.mode.kind === 'real' ? 'Ejecución real' : activity.mode.kind === 'trace' ? 'Traza de referencia' : activity.mode.kind === 'documentary' ? 'Caso documental' : 'Simulación'} · {activity.mode.engine} {activity.mode.version}</p>
      <p>{activity.mode.limits}</p>
      {activity.claims.map((claim, i) => { const source = pack.sources.find(s => s.id === claim.sourceId)!; return <p key={i}>{claim.text} · <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>, {source.edition}, {claim.locator}</p> })}
    </details>}
  </div>
}
