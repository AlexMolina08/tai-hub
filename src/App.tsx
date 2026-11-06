import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  ArrowLeft, ArrowRight, BookOpen, ChevronRight, Clock3, Cloud, CloudOff, Download, Ellipsis,
  ExternalLink, FileSearch, FolderOpen, LayoutGrid, LibraryBig, List, LockKeyhole, LogOut,
  Menu, Moon, Plus, RefreshCw, Search, Settings2, Star, Sun, Trash2, Upload, X,
} from 'lucide-react'
import { GoogleSession, DriveLibrary, StudySync, type Resource, type ResourceDraft, type StudyPatch, type StudyState } from './drive'
import type { PdfIndex, PdfSearchHit } from './pdf/index'
import { blocks, syllabusSource, topicById } from './syllabus'
import { bytes, driveLink, fold, kinds, locationName } from './resources'
import { Dialog } from './components/Dialog'
import { ImportPanel } from './components/ImportPanel'
import { ResourceForm } from './components/ResourceForm'
import { ResourceView } from './components/ResourceView'

const PdfReader = lazy(() => import('./components/PdfReader'))
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const session = new GoogleSession(clientId, {
  redirectUri: new URL(import.meta.env.BASE_URL, window.location.origin).href,
  useRedirect: ios,
})
const library = new DriveLibrary(session)
const emptyStudy: StudyState = { favorites: {}, positions: {}, annotations: {} }
const subscribeIdle = () => () => {}
const getEmptyStudy = () => emptyStudy

type View = { page: 'home' | 'general' | 'favorites' | 'recent' | 'review' | 'search' }
  | { page: 'block' | 'topic'; id: string }
  | { page: 'resource'; id: string; initialPage?: number; query?: string }
type Modal = { kind: 'add' | 'import' | 'settings'; resource?: never }
  | { kind: 'edit' | 'manage' | 'trash' | 'versions'; resource: Resource }
type Revision = Awaited<ReturnType<DriveLibrary['revisions']>>[number]
const mainNav = [
  { page: 'home', label: 'Inicio', icon: LayoutGrid },
  { page: 'general', label: 'General', icon: FolderOpen },
  { page: 'favorites', label: 'Favoritos', icon: Star },
  { page: 'recent', label: 'Recientes', icon: Clock3 },
] as const
const tones = ['green', 'blue', 'violet', 'ochre']
const emptyFilters = { kind: '', source: '', tag: '' }
const searchBatch = 80
const initialSearchLimits = { resources: searchBatch, pages: searchBatch }
const emptyPageResults = { query: '', documents: '', hits: [] as PdfSearchHit[] }

export default function App() {
  const auth = useSyncExternalStore(session.subscribe, session.snapshot)
  const connected = auth.status === 'connected'
  const [account, setAccount] = useState<Awaited<ReturnType<DriveLibrary['account']>>>()
  const [resources, setResources] = useState<Resource[]>([])
  const [sync, setSync] = useState<StudySync>()
  const [index, setIndex] = useState<PdfIndex>()
  const [indexTick, setIndexTick] = useState(0)
  const [indexWorking, setIndexWorking] = useState(false)
  const [indexError, setIndexError] = useState('')
  const [indexRun, setIndexRun] = useState(0)
  const [network, setNetwork] = useState(navigator.onLine)
  const [view, setView] = useState<View>({ page: 'home' })
  const [back, setBack] = useState<{ view: View; scroll: number }>({ view: { page: 'home' }, scroll: 0 })
  const [filters, setFilters] = useState(emptyFilters)
  const [query, setQuery] = useState('')
  const [searchLimits, setSearchLimits] = useState(initialSearchLimits)
  const [pageResults, setPageResults] = useState(emptyPageResults)
  const [searchError, setSearchError] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [modal, setModal] = useState<Modal>()
  const [revisions, setRevisions] = useState<Revision[]>()
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('tai-theme') || 'system' }
    catch { return 'system' }
  })
  const search = useRef<HTMLInputElement>(null)
  const nextScroll = useRef(0)
  const study = useSyncExternalStore(sync ? fn => sync.subscribe(fn) : subscribeIdle, sync ? () => sync.snapshot() : getEmptyStudy)
  const studyStatus = useSyncExternalStore(sync?.subscribe ?? subscribeIdle, sync?.status ?? (() => 'idle'))
  const accountId = account?.id
  const current = view.page === 'resource' ? resources.find(item => item.id === view.id) : undefined
  const readingPdf = current?.kind === 'pdf'
  const searching = view.page === 'search'
  const cleanQuery = query.trim()

  useEffect(() => { if (clientId) void session.prepare().catch(() => {}) }, [])
  useLayoutEffect(() => { window.scrollTo({ top: nextScroll.current, behavior: 'instant' }) }, [view])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('tai-theme', theme) } catch { /* Browser storage unavailable. */ }
  }, [theme])
  useEffect(() => {
    const toggle = () => setNetwork(navigator.onLine)
    window.addEventListener('online', toggle)
    window.addEventListener('offline', toggle)
    return () => { window.removeEventListener('online', toggle); window.removeEventListener('offline', toggle) }
  }, [])
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        search.current?.focus()
      }
      if (event.key === 'Escape') setDrawer(false)
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [])

  function showError(failure: unknown) {
    setError(failure instanceof Error ? failure.message : 'La operación no se pudo completar.')
  }
  function navigate(next: View, restoreScroll?: number) {
    nextScroll.current = restoreScroll ?? 0
    if (restoreScroll === undefined && next.page !== 'resource') setFilters(emptyFilters)
    setView(next)
    setDrawer(false)
    setNotice('')
    setError('')
  }
  function returnToList() {
    navigate(back.view, back.scroll)
  }
  function connect(sameTab?: boolean) {
    setError('')
    if (auth.status === 'error') {
      void session.prepare().then(() => {
        if (session.snapshot().status === 'ready') setNotice('Pulsa Conectar Drive para abrir la ventana de Google.')
      })
    }
    void session.connect({ sameTab }).catch(showError)
  }
  function clearPrivate() {
    setAccount(undefined)
    setResources([])
    changeQuery('')
    setPageResults(emptyPageResults)
    setModal(undefined)
    navigate({ page: 'home' })
  }
  const refresh = useCallback(async () => {
    setWorking(true)
    try {
      const user = await library.account()
      const items = await library.list()
      setAccount(user)
      setResources(items)
      setError('')
    } catch (failure) { showError(failure) }
    finally { setWorking(false) }
  }, [])
  useEffect(() => { if (connected) void refresh() }, [connected, refresh])

  useEffect(() => {
    if (!accountId) { setSync(undefined); setIndex(undefined); return }
    const nextSync = new StudySync(library, accountId)
    setSync(nextSync)
    let live = true
    let nextIndex: PdfIndex | undefined
    void import('./pdf/index').then(({ PdfIndex }) => {
      if (!live) return
      nextIndex = new PdfIndex(accountId, {
        loadIndex: (id, version) => library.loadIndex(id, version),
        saveIndex: (id, version, value) => library.saveIndex(id, version, value),
      })
      setIndex(nextIndex)
    }).catch(failure => { if (live) showError(failure) })
    return () => { live = false; nextSync.close(); nextIndex?.dispose() }
  }, [accountId])
  useEffect(() => {
    if (!sync || !connected) return
    void sync.refresh().catch(() => {})
  }, [sync, connected])

  const pdfVersions = JSON.stringify(resources.filter(resource => resource.kind === 'pdf')
    .map(({ id, version }) => ({ id, version })).sort((a, b) => a.id.localeCompare(b.id)))
  const indexDocuments: { id: string; version: string }[] = useMemo(() => JSON.parse(pdfVersions), [pdfVersions])
  useEffect(() => {
    if (!index) return
    const abort = new AbortController()
    setIndexWorking(false)
    if (readingPdf) return
    setIndexError('')
    let live = true
    void (async () => {
      await index.hydrate(indexDocuments)
      if (!live) return
      setIndexTick(tick => tick + 1)
      if (!connected || !network || !indexDocuments.length) return
      setIndexWorking(true)
      try {
        await index.sync(indexDocuments, {
          source: id => library.pdfSource(id),
          signal: abort.signal,
          onProgress: ({ phase, error }) => {
            if (!live) return
            if (phase === 'done' || phase === 'error') setIndexTick(tick => tick + 1)
            if (error) setIndexError('Algunos PDF requieren reintentar la extracción o la sincronización.')
          },
        })
      } finally {
        if (live) { setIndexWorking(false); setIndexTick(tick => tick + 1) }
      }
    })().catch(() => {
      if (live) setIndexError('El índice no se pudo completar. Puedes reintentar.')
    })
    return () => { live = false; abort.abort() }
  }, [index, indexDocuments, connected, network, indexRun, readingPdf])
  useEffect(() => {
    if (!searching || cleanQuery.length < 2 || !index) return
    let active = true
    setSearchError(false)
    const timer = setTimeout(() => {
      void index.search(cleanQuery, searchLimits.pages + 1)
        .then(hits => { if (active) setPageResults({ query: cleanQuery, documents: pdfVersions, hits }) })
        .catch(() => { if (active) setSearchError(true) })
    }, 100)
    return () => { active = false; clearTimeout(timer) }
  }, [cleanQuery, index, indexTick, pdfVersions, searchLimits.pages, searching])

  function apply(patch: StudyPatch) {
    void sync?.apply(patch).catch(showError)
  }
  function markOpened(resource: Resource, page: number) {
    apply({ kind: 'position', resourceId: resource.id, value: { version: resource.version, page, openedAt: new Date().toISOString() } })
  }
  function open(resource: Resource, page?: number, highlight?: string) {
    const previous = study.positions[resource.id]
    const lastPage = previous?.version === resource.version ? previous.page : 1
    if (view.page !== 'resource') setBack({ view, scroll: window.scrollY })
    markOpened(resource, resource.kind === 'pdf' ? page ?? lastPage : 0)
    navigate({ page: 'resource', id: resource.id, initialPage: page ?? lastPage, query: highlight })
  }
  function favorite(resource: Resource) {
    apply({ kind: 'favorite', resourceId: resource.id, value: !study.favorites[resource.id] })
  }
  function download(resource: Resource, revisionId?: string) {
    void library.download(resource, revisionId).catch(showError)
  }
  async function save(draft: ResourceDraft, file?: File, replacement?: File, progress?: (done: number, total: number) => void) {
    if (modal?.resource) {
      if (replacement) {
        const revised = await library.replace(modal.resource.id, replacement, progress)
        setResources(items => items.map(item => item.id === revised.id ? revised : item))
      }
      const updated = await library.update(modal.resource.id, draft)
      setResources(items => items.map(item => item.id === updated.id ? updated : item))
    } else {
      const created = await library.create(draft, file, progress)
      setResources(items => [...items, created])
    }
    setModal(undefined)
    setNotice('Recurso guardado en Drive.')
  }
  function versions(resource: Resource) {
    setRevisions(undefined)
    setModal({ kind: 'versions', resource })
    void library.revisions(resource.id).then(setRevisions).catch(failure => { setRevisions([]); showError(failure) })
  }
  async function trash() {
    const item = modal?.resource
    if (!item || !connected) return
    setWorking(true)
    try {
      await library.trash(item.id)
      setResources(items => items.filter(resource => resource.id !== item.id))
      setModal(undefined)
      returnToList()
      setNotice('Recurso enviado a la papelera de Drive.')
    } catch (failure) { showError(failure) }
    finally { setWorking(false) }
  }
  const sourceNames = useMemo(() => [...new Set(resources.map(item => item.source))].sort((a, b) => a.localeCompare(b, 'es')), [resources])
  const topic = view.page === 'topic' ? topicById.get(view.id) : undefined
  const block = view.page === 'block' ? blocks.find(item => item.id === view.id) : topic?.block
  const recent = useMemo(() => resources.filter(item => study.positions[item.id])
    .sort((a, b) => study.positions[b.id].openedAt.localeCompare(study.positions[a.id].openedAt)), [resources, study])
  const visible = view.page === 'general' ? resources.filter(item => item.topicId === null)
    : view.page === 'favorites' ? resources.filter(item => study.favorites[item.id])
    : view.page === 'recent' ? recent
    : view.page === 'review' ? resources.filter(item => item.needsReview)
    : topic ? resources.filter(item => item.topicId === topic.id || item.relatedTopicIds?.includes(topic.id))
    : []
  const reviewCount = resources.filter(item => item.needsReview).length
  const indexStats = useMemo(() => {
    const result = { indexed: 0, 'no-text': 0, pending: 0, error: 0, partial: 0 }
    for (const doc of indexDocuments) {
      const status = index?.status(doc) ?? 'pending'
      if (status in result) result[status as keyof typeof result]++
    }
    return result
  // Index mutates in place. The counter invalidates this summary when a document changes.
  }, [index, indexDocuments, indexTick])
  const openLocation = (id: string | null) => navigate(id ? { page: 'topic', id } : { page: 'general' })
  function changeQuery(value: string) {
    if (value.trim() !== cleanQuery) setSearchLimits(initialSearchLimits)
    setQuery(value)
  }
  const startSearch = (value: string) => {
    changeQuery(value)
    if (view.page !== 'search') navigate({ page: 'search' })
  }
  const title = topic?.title ?? block?.title ?? ({
    home: 'Biblioteca', general: 'General', favorites: 'Favoritos', recent: 'Recientes',
    review: 'Por revisar', search: 'Búsqueda', resource: current?.title ?? 'Recurso', topic: 'Tema', block: 'Bloque',
  })[view.page]
  const listProps = { open, favorite, study, index, connected }
  const showConnect = !account && !connected && auth.status !== 'connecting'

  return <div className="app-shell">
    <a className="skip-link" href="#main">Saltar al contenido</a>
    {drawer && <button className="scrim" aria-label="Cerrar navegación" onClick={() => setDrawer(false)} />}
    <aside className={drawer ? 'sidebar sidebar-open' : 'sidebar'} aria-label="Navegación principal">
      <button className="brand" onClick={() => navigate({ page: 'home' })}>
        <img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" width="42" height="42" />
        <span><strong>TAI Hub</strong><small>Estudio personal</small></span>
      </button>
      <nav className="nav-primary">
        {mainNav.map(({ page, label, icon: Icon }) => <button key={page} aria-current={view.page === page ? 'page' : undefined}
          onClick={() => navigate({ page })}><Icon size={18} /> {label}</button>)}
        {reviewCount > 0 && <button aria-current={view.page === 'review' ? 'page' : undefined} onClick={() => navigate({ page: 'review' })}><List size={18} /> Por revisar <span className="nav-count">{reviewCount}</span></button>}
      </nav>
      <div className="nav-heading">Temario oficial <span>33 temas</span></div>
      <nav className="nav-blocks">
        {blocks.map((item, i) => <button key={item.id} aria-current={block?.id === item.id ? 'page' : undefined}
          onClick={() => navigate({ page: 'block', id: item.id })}>
          <span className={`block-number ${tones[i]}`}>{item.roman}</span><span>{item.title}</span><ChevronRight size={14} />
        </button>)}
      </nav>
      <div className="sidebar-footer">
        <button className="nav-setting" onClick={() => { setModal({ kind: 'settings' }); setDrawer(false) }}><Settings2 size={17} /> Ajustes</button>
        <div className="sidebar-status"><span className={connected && network ? 'status-dot online' : 'status-dot'} />
          {connected && network ? 'Drive conectado' : 'Biblioteca privada'}</div>
      </div>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label="Abrir navegación" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}><Menu size={22} /></button>
        <form className="global-search" role="search" onSubmit={event => { event.preventDefault(); startSearch(query) }}>
          <Search size={20} /><input ref={search} value={query} placeholder="Buscar en la biblioteca…" aria-label="Buscar en la biblioteca" onChange={event => {
            const input = event.nativeEvent
            if (!searching && 'inputType' in input && (input.inputType === 'historyUndo' || input.inputType === 'historyRedo')) return
            startSearch(event.target.value)
          }} />
          {query ? <button type="button" className="icon-button" aria-label="Borrar búsqueda" onClick={() => { changeQuery(''); search.current?.focus() }}><X size={16} /></button> : <kbd>⌘ K</kbd>}
        </form>
        <button className="button add-top" aria-label="Añadir recurso" disabled={!connected || !account} onClick={() => setModal({ kind: 'add' })}><Plus size={18} /><span>Añadir recurso</span></button>
        <button className="avatar" onClick={() => setModal({ kind: 'settings' })} aria-label="Cuenta y ajustes">{account?.name ? account.name.charAt(0).toUpperCase() : <Settings2 size={17} />}</button>
      </header>

      <main className={current ? 'content content-reader' : 'content'} id="main" tabIndex={-1}>
        {!network && <div className="banner" role="status"><CloudOff size={18} /> Sin conexión. Las operaciones de Drive se reanudarán al volver a conectar.</div>}
        {account && !connected && <div className="banner"><CloudOff size={18} /><span>Renueva el acceso a Drive para abrir archivos y sincronizar.</span><button className="button" disabled={auth.status === 'connecting'} onClick={() => connect()}>Reconectar</button></div>}
        {(error || (auth.status === 'error' && auth.error)) && <div className="banner error" role="alert"><span>{error || auth.error}</span>
          {connected && !account && <button className="button" disabled={working} onClick={() => void refresh()}>Reintentar</button>}
          {!ios && auth.status === 'error' && <button className="button" onClick={() => connect(true)}>Conectar en esta pestaña</button>}
          {error && <button className="icon-button" aria-label="Cerrar aviso" onClick={() => setError('')}><X size={17} /></button>}
        </div>}
        {notice && <div className="banner success" role="status"><span>{notice}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setNotice('')}><X size={17} /></button></div>}
        {view.page === 'home' ? <>
          <div className="page-heading"><p className="context-label"><LibraryBig size={17} /> TAI AGE · Acceso libre</p><h1>Biblioteca de estudio</h1></div>
          <section className="hero" aria-label={account ? 'Continuar estudio' : 'Conexión con Google Drive'}>
            <div className="hero-copy">
              <span className="hero-kicker">{account ? <><BookOpen size={16} /> {recent[0] ? 'Último recurso' : 'Biblioteca privada'}</> : <><LockKeyhole size={15} /> Biblioteca privada</>}</span>
              <h2>{account ? recent[0]?.title ?? (resources.length ? `${resources.length} recursos` : 'Añadir el primer recurso') : 'Google Drive'}</h2>
              <p>{account
                ? recent[0] ? locationName(recent[0].topicId) : resources.length ? `${indexStats.indexed} PDF indexados` : 'Puedes añadir archivos, enlaces y notas.'
                : 'Conecta tu cuenta para consultar la biblioteca y sincronizar el progreso.'}</p>
              {account && recent[0] ? <button className="hero-button" onClick={() => open(recent[0])}>Abrir último recurso <ArrowRight size={17} /></button>
                : account ? <button className="hero-button" disabled={!connected} onClick={() => setModal({ kind: 'add' })}><Plus size={17} /> Añadir recurso</button>
                  : <button className="hero-button" disabled={!clientId || ['loading', 'connecting', 'connected'].includes(auth.status)} onClick={() => connect()}><Cloud size={18} />
                    {auth.status === 'connecting' ? 'Conectando…' : connected || working ? 'Cargando biblioteca…' : 'Conectar Google Drive'}<ArrowRight size={17} /></button>}
              {!clientId && <p className="hero-note">Falta configurar el Client ID público.</p>}
            </div>
            <HeroArt />
          </section>
          <section className="section">
            <div className="section-head"><div><h2>Temario oficial</h2><p>4 bloques · 33 temas</p></div>
              <a href={syllabusSource} target="_blank" rel="noreferrer" className="text-link">Ver convocatoria <ExternalLink size={15} /></a></div>
            <div className="block-grid">{blocks.map((item, i) => <button className="block-card" key={item.id} onClick={() => navigate({ page: 'block', id: item.id })}>
              <span className={`block-number ${tones[i]}`}>{item.roman}</span><span><strong>{item.title}</strong><small>{item.topics.length} temas</small></span><ChevronRight size={18} />
            </button>)}</div>
          </section>
          <section className="section"><div className="section-head"><h2>Accesos rápidos</h2></div>
            <div className="shortcut-grid">{mainNav.slice(1).map(({ page, label, icon: Icon }) => <button key={page} className="shortcut" onClick={() => navigate({ page })}><Icon size={19} /> {label}<ChevronRight size={16} /></button>)}</div>
          </section>
        </> : view.page === 'search' ? <>
          <div className="page-heading"><p className="context-label"><Search size={17} /> Biblioteca</p><h1>Búsqueda</h1><p>Busca por título, fuente y texto dentro de los PDF.</p></div>
          <SearchResults query={cleanQuery} pageResults={pageResults.documents === pdfVersions ? pageResults : emptyPageResults} error={searchError} resources={resources}
            limits={searchLimits} loadMore={kind => setSearchLimits(current => ({ ...current, [kind]: current[kind] + searchBatch }))}
            indexing={indexWorking} hasAccount={!!account} open={open} />
        </> : current && view.page === 'resource' ? <>
          <div className="resource-topline">
            <button className="text-link" onClick={returnToList}><ArrowLeft size={17} /> Volver</button>
            <div className="resource-actions">
              <button className="button resource-favorite" aria-label={study.favorites[current.id] ? 'Quitar de favoritos' : 'Guardar en favoritos'}
                aria-pressed={!!study.favorites[current.id]} onClick={() => favorite(current)}>
                <Star size={17} className={study.favorites[current.id] ? 'filled' : ''} /><span>Favorito</span>
              </button>
              <button className="button" disabled={!connected} onClick={() => setModal({ kind: 'manage', resource: current })}><Ellipsis size={18} /> Opciones</button>
            </div>
          </div>
          <div className="page-heading resource-heading">
            <p className="context-label">{locationName(current.topicId)}</p><h1>{current.title}</h1>
            <p>{[current.source, kinds[current.kind].label, bytes(current.size)].filter(Boolean).join(' · ')}</p>
          </div>
          {current.kind === 'pdf' ? connected
            ? <PdfPane key={`${current.id}:${current.version}`} resource={current} initialPage={study.positions[current.id]?.version === current.version
                ? study.positions[current.id].page : view.initialPage} query={view.query}
              annotations={study.annotations[current.id]?.[current.version] ?? []}
              onPage={page => markOpened(current, page)}
              apply={apply} reconnect={() => connect()} download={() => download(current)} />
            : <div className="empty"><CloudOff size={24} /><p>Conecta Drive para cargar el PDF.</p></div>
            : <ResourceView key={`${current.id}:${current.version}`} resource={current} library={library} download={() => download(current)} />}
        </> : <>
          {block && <button className="text-link back-link" onClick={() => navigate(topic ? { page: 'block', id: block.id } : { page: 'home' })}>
            <ArrowLeft size={17} /> {topic ? `Bloque ${block.roman}` : 'Biblioteca'}</button>}
          <div className="page-heading"><p className="context-label">{topic ? `Bloque ${topic.block.roman} · Tema ${topic.number}` : block ? `Bloque ${block.roman}` : 'Biblioteca'}</p>
            <h1>{title}</h1><p>{topic?.description ?? (block ? `${block.topics.length} temas del programa oficial` :
              view.page === 'general' ? 'Convocatorias, exámenes y materiales transversales.' :
              view.page === 'favorites' ? 'Recursos que has guardado para volver a consultar.' :
              view.page === 'review' ? 'Material que aún necesita confirmar su ubicación.' : 'Últimos recursos que has consultado.')}</p></div>
          {view.page === 'block' && block ? <div className="topic-list">
            {block.topics.map(item => <button key={item.id} onClick={() => openLocation(item.id)}>
              <span className={`block-number ${tones[blocks.indexOf(block)]}`}>{item.number}</span>
              <span><strong>{item.title}</strong><small>{resources.filter(resource => resource.topicId === item.id || resource.relatedTopicIds?.includes(item.id)).length} recursos</small></span><ChevronRight size={18} />
            </button>)}
          </div> : <ResourceList items={visible} filters={filters} setFilters={setFilters} {...listProps}
            empty={showConnect ? 'Conecta Google Drive para ver tus recursos.' : 'Todavía no hay recursos en esta sección.'}
            onEmpty={showConnect && clientId ? () => connect() : connected && (topic || view.page === 'general') ? () => setModal({ kind: 'add' }) : undefined}
            emptyAction={showConnect ? 'Conectar Drive' : 'Añadir recurso'} />}
        </>}
      </main>

      <nav className="mobile-nav" aria-label="Accesos principales">
        {mainNav.map(({ page, label, icon: Icon }) => <button key={page} aria-current={view.page === page ? 'page' : undefined} onClick={() => navigate({ page })}><Icon size={19} />{label}</button>)}
      </nav>
    </div>

    {modal && <Dialog key={modal.kind} title={({
      add: 'Añadir recurso', edit: 'Editar recurso', manage: 'Opciones del recurso', trash: 'Enviar a la papelera',
      versions: 'Versiones del original', import: 'Importar biblioteca', settings: 'Ajustes',
    })[modal.kind]} onClose={() => { if (modal.kind === 'import') void refresh(); setModal(undefined) }}>
      {(modal.kind === 'add' || modal.kind === 'edit') && <ResourceForm resource={modal.resource} initialTopic={topic?.id ?? null} sources={sourceNames} save={save} />}
      {modal.kind === 'manage' && <div className="resource-options">
        <button className="button" disabled={!connected} onClick={() => setModal({ kind: 'edit', resource: modal.resource })}><Settings2 size={17} /> Editar ficha</button>
        {driveLink(modal.resource) && <button className="button" disabled={!connected} onClick={() => versions(modal.resource)}><Clock3 size={17} /> Versiones</button>}
        <button className="button danger-text" disabled={!connected} onClick={() => setModal({ kind: 'trash', resource: modal.resource })}><Trash2 size={17} /> Enviar a papelera</button>
      </div>}
      {modal.kind === 'import' && <ImportPanel library={library} onChange={refresh} connected={connected} reconnect={() => connect()} />}
      {modal.kind === 'trash' && <div className="settings-panel"><p>¿Enviar «{modal.resource?.title}» a la papelera de Drive? Puedes recuperarlo desde Drive.</p>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="actions"><button className="button" onClick={() => setModal(undefined)}>Cancelar</button><button className="button danger" disabled={working} onClick={trash}>Enviar a papelera</button></div></div>}
      {modal.kind === 'versions' && <div className="settings-panel"><p>Las versiones guardadas conservan el archivo original de cada revisión.</p>
        {error && <p role="alert" className="form-error">{error}</p>}
        {!revisions ? <p role="status">Consultando Drive…</p> : !revisions.length ? <p>No hay revisiones disponibles.</p> :
          revisions.map((revision, i) => <div className="revision" key={revision.id}><span>{revision.modifiedTime ? new Date(revision.modifiedTime).toLocaleString('es') : `Revisión ${i + 1}`}</span>
            <button className="button" onClick={() => modal.resource && download(modal.resource, revision.id)}><Download size={16} /> Descargar</button></div>)}</div>}
      {modal.kind === 'settings' && <div className="settings-panel">
        <section><h3>Apariencia</h3><div className="segmented">{[['system', 'Sistema', Settings2], ['light', 'Claro', Sun], ['dark', 'Oscuro', Moon]].map(([value, label, Icon]) => {
          const ThemeIcon = Icon as typeof Sun
          return <button type="button" key={String(value)} aria-pressed={theme === value} onClick={() => setTheme(String(value))}><ThemeIcon size={16} />{String(label)}</button>
        })}</div></section>
        <section><h3>Google Drive</h3><p>{account ? `${account.name} · ${connected ? 'Conectado' : 'Acceso caducado'}` : 'Conecta tu biblioteca privada.'}</p>
          {account && <p>{account.storage.limit !== undefined ? `${bytes(Math.max(0, account.storage.limit - account.storage.usage))} disponibles en Drive` : ''}</p>}
          {account && studyStatus !== 'idle' && <p role="status">{studyStatus === 'error' ? 'El progreso sigue en este navegador. Drive reintentará la sincronización.' : 'Sincronizando el progreso…'}</p>}
          {error && <p role="alert" className="form-error">{error}</p>}
          <div className="actions">{connected && account ? <>
            <button className="button" disabled={working} onClick={() => { void refresh(); void sync?.refresh().catch(showError) }}><RefreshCw size={16} /> Actualizar</button>
            <button className="button" onClick={() => setModal({ kind: 'import' })}><Upload size={16} /> Importar carpeta</button>
            <button className="button" onClick={() => { session.disconnect(); clearPrivate() }}><LogOut size={16} /> Desconectar</button>
          </> : <button className="button primary" disabled={!clientId || auth.status === 'loading' || auth.status === 'connecting'} onClick={() => connect()}><Cloud size={17} /> Conectar Drive</button>}</div>
        </section>
        {account && <section><h3>Índice de búsqueda</h3><p>{indexStats.indexed} PDF indexados · {indexStats['no-text']} sin texto extraíble · {indexStats.pending} pendientes</p>
          {!!(indexStats.error || indexStats.partial) && <p>{indexStats.error} con error · {indexStats.partial} parcialmente indexados</p>}
          <p>{indexWorking ? 'Actualizando el índice privado…' : indexError || 'El índice se guarda en este navegador y en tu Drive.'}</p>
          <button className="button" disabled={indexWorking || !connected} onClick={() => setIndexRun(run => run + 1)}><FileSearch size={16} /> Comprobar índice</button>
        </section>}
      </div>}
    </Dialog>}
  </div>
}

function HeroArt() {
  return <svg className="hero-art" viewBox="0 0 420 250" fill="none" aria-hidden="true">
    <defs><pattern id="hero-grid" width="21" height="21" patternUnits="userSpaceOnUse"><path d="M21 0H0v21" stroke="currentColor" opacity=".2"/></pattern></defs>
    <path d="M32 0h388v250H32z" fill="url(#hero-grid)" />
    <g stroke="currentColor" strokeWidth="1.5" opacity=".8" strokeLinejoin="round">
      <path d="M106 107l111-59 123 66-112 66z" fill="#225744" />
      <path d="M106 123l122 72 112-66M106 140l122 72 112-66M106 157l122 72 112-66" />
      <path d="M145 102l73-40 79 42-74 42zM176 99l45-24m-27 35 43-24m-26 34 42-24m-27 34 44-25" />
      <path d="M78 85h37l37-22m129-19 27-16h58m-13 129h26v39h37M50 170h38l23-13m168 47h43v29h43" opacity=".7"/>
      <circle cx="78" cy="85" r="3"/><circle cx="366" cy="28" r="3"/><circle cx="50" cy="170" r="3"/><circle cx="365" cy="233" r="3"/>
    </g>
    <g fill="currentColor"><circle cx="340" cy="114" r="3"/><circle cx="228" cy="180" r="3"/><circle cx="106" cy="107" r="3"/></g>
  </svg>
}

type ListProps = {
  open: (resource: Resource, page?: number, query?: string) => void
  favorite: (resource: Resource) => void
  study: StudyState
  index?: PdfIndex
  connected: boolean
}
function ResourceList({ items, open, favorite, study, index, filters, setFilters, empty, onEmpty, emptyAction }: ListProps & {
  items: Resource[]; empty: string; onEmpty?: () => void; emptyAction: string
  filters: typeof emptyFilters; setFilters: (filters: typeof emptyFilters) => void
}) {
  const { kind, source, tag } = filters
  const filtered = items.filter(item => (!kind || item.kind === kind) && (!source || item.source === source) && (!tag || item.tags.includes(tag)))
  if (!items.length) return <div className="empty"><FolderOpen size={25} /><p>{empty}</p>{onEmpty && <button className="button primary" onClick={onEmpty}>{emptyAction}</button>}</div>
  return <>
    <div className="filters">
      <label><span>Tipo</span><select value={kind} onChange={event => setFilters({ ...filters, kind: event.target.value })}><option value="">Todos los tipos</option>
        {[...new Set(items.map(item => item.kind))].map(value => <option value={value} key={value}>{kinds[value].label}</option>)}</select></label>
      <label><span>Fuente</span><select value={source} onChange={event => setFilters({ ...filters, source: event.target.value })}><option value="">Todas las fuentes</option>
        {[...new Set(items.map(item => item.source))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
      <label><span>Etiqueta</span><select value={tag} onChange={event => setFilters({ ...filters, tag: event.target.value })}><option value="">Todas las etiquetas</option>
        {[...new Set(items.flatMap(item => item.tags))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
      <span>{filtered.length} {filtered.length === 1 ? 'recurso' : 'recursos'}</span>
    </div>
    {filtered.length ? <div className="resource-list">{filtered.map(item => {
      const Icon = kinds[item.kind].icon
      const status = item.kind === 'pdf' ? index?.status(item) : undefined
      return <article className="resource-row" key={item.id}>
        <button className="row-main" onClick={() => open(item)}><span className={`file-icon kind-${item.kind}`}><Icon size={20} /></span>
          <span><strong>{item.title}</strong><small>{[item.source, kinds[item.kind].label, bytes(item.size), status === 'no-text' ? 'Sin texto extraíble' : '', item.needsReview ? 'Por revisar' : ''].filter(Boolean).join(' · ')}</small>
            {item.tags.length > 0 && <span className="tag-list">{item.tags.map(label => <span key={label}>{label}</span>)}</span>}</span></button>
        <button className="icon-button" aria-pressed={!!study.favorites[item.id]} aria-label={study.favorites[item.id] ? 'Quitar de favoritos' : 'Guardar en favoritos'} onClick={() => favorite(item)}><Star size={19} className={study.favorites[item.id] ? 'filled' : ''} /></button>
      </article>
    })}</div> : <div className="empty"><FileSearch size={25} /><p>No hay recursos con estos filtros.</p><button className="button" onClick={() => setFilters(emptyFilters)}>Quitar filtros</button></div>}
  </>
}

function SearchResults({ query, pageResults, error, resources, limits, loadMore, indexing, hasAccount, open }: {
  query: string; pageResults: { query: string; hits: PdfSearchHit[] }; error: boolean; resources: Resource[]
  limits: typeof initialSearchLimits; loadMore: (kind: keyof typeof initialSearchLimits) => void
  indexing: boolean; hasAccount: boolean; open: ListProps['open']
}) {
  if (!hasAccount || query.length < 2) return <div className="empty"><Search size={26} /><p>{hasAccount ? 'Escribe al menos dos caracteres.' : 'Conecta Drive para buscar en tus documentos.'}</p></div>
  const terms = fold(query).split(/\s+/)
  const found = resources.filter(item => terms.every(term => fold([item.title, item.source, ...item.tags, locationName(item.topicId)].join(' ')).includes(term)))
  const byId = new Map(resources.map(item => [item.id, item]))
  const hits = pageResults.query === query ? pageResults.hits.filter(hit => byId.has(hit.id)) : []
  const morePages = hits.length > limits.pages
  return <div className="search-results">
    {indexing && <p className="form-hint" role="status">Índice en actualización. Irán apareciendo más páginas.</p>}
    {error && <p className="form-error" role="alert">La búsqueda de páginas no se pudo completar.</p>}
    {found.length > 0 && <section><h2>Recursos <small>{found.length}</small></h2><div className="resource-list">
      {found.slice(0, limits.resources).map(item => { const Icon = kinds[item.kind].icon; return <button className="search-item" key={item.id} onClick={() => open(item)}>
        <span className={`file-icon kind-${item.kind}`}><Icon size={19} /></span><span><strong>{item.title}</strong><small>{locationName(item.topicId)} · {item.source}</small></span><ChevronRight size={18} />
      </button> })}
    </div>{found.length > limits.resources && <div className="actions"><button className="button" onClick={() => loadMore('resources')}>Mostrar más recursos</button></div>}</section>}
    {hits.length > 0 && <section><h2>Dentro de PDF <small>{morePages ? `${limits.pages}+` : hits.length}</small></h2><div className="resource-list">
      {hits.slice(0, limits.pages).map(hit => { const item = byId.get(hit.id)!; return <button className="search-item" key={`${hit.id}:${hit.page}`} onClick={() => open(item, hit.page, query)}>
        <span className="file-icon kind-pdf"><FileSearch size={19} /></span>
        <span><strong>{item.title}</strong><small>{locationName(item.topicId)} · Página {hit.page}</small><span className="snippet">{hit.snippet}</span></span><ChevronRight size={18} />
      </button> })}
    </div>{morePages && <div className="actions"><button className="button" onClick={() => loadMore('pages')}>Mostrar más páginas</button></div>}</section>}
    {!found.length && !hits.length && !indexing && pageResults.query === query && <div className="empty"><FileSearch size={25} /><p>No hay coincidencias para «{query}».</p></div>}
  </div>
}

type ReaderAnnotations = StudyState['annotations'][string][string]
function PdfPane({ resource, initialPage, query, annotations, onPage, apply, download, reconnect }: {
  resource: Resource; initialPage?: number; query?: string; annotations: ReaderAnnotations
  onPage: (page: number) => void; apply: (patch: StudyPatch) => void; download: () => void; reconnect: () => void
}) {
  const source = useMemo(() => {
    try { return { ...library.pdfSource(resource.id), byteLength: resource.size } }
    catch { return undefined }
  }, [resource.id, resource.version, resource.size])
  if (!source) return <div className="empty"><CloudOff size={24} /><p>Renueva el acceso a Drive para abrir el PDF.</p><button className="button" onClick={reconnect}>Reconectar</button></div>
  return <Suspense fallback={<div className="empty" role="status">Abriendo lector…</div>}>
    <PdfReader source={source} initialPage={initialPage} initialQuery={query} annotations={annotations} originalUrl={driveLink(resource)}
      onPageChange={onPage} onDownload={download} onReconnect={reconnect}
      onAnnotationAdd={value => apply({ kind: 'annotation', resourceId: resource.id, version: resource.version, annotationId: value.id, value })}
      onAnnotationRemove={annotationId => apply({ kind: 'annotation', resourceId: resource.id, version: resource.version, annotationId, value: null })} />
  </Suspense>
}
