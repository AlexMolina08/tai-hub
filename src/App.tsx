import { Fragment, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  ArrowLeft, ArrowRight, BookOpen, ChevronRight, ClipboardList, Clock3, Cloud, CloudOff, Download, Ellipsis,
  ExternalLink, FileSearch, FolderOpen, Landmark, LayoutGrid, LibraryBig, List, LockKeyhole, LogOut,
  Menu, Moon, Plus, RefreshCw, Search, Settings2, Star, Sun, Trash2, Upload, X,
} from 'lucide-react'
import { GoogleSession, DriveLibrary, StudySync, DriveError, type Resource, type ResourceDraft, type StudyPatch, type StudyState } from './drive'
import { readCatalogue, saveCatalogue } from './drive/catalogue-cache'
import type { PdfIndex, PdfSearchHit } from './pdf/index'
import { isPdfReadingPosition, type PdfReadingPosition } from './pdf/model'
import { matchRanges } from './pdf/text'
import { blocks, syllabusSource, topicById } from './syllabus'
import { bytes, driveLink, fold, kinds, locationName } from './resources'
import { Dialog } from './components/Dialog'
import { ImportPanel } from './components/ImportPanel'
import { OfficialInap, useOfficialInap } from './components/OfficialInap'
import { ResourceForm } from './components/ResourceForm'
import { ResourceView } from './components/ResourceView'

const PdfReader = lazy(() => import('./components/PdfReader'))
const Laboratory = lazy(() => import('./lab/Laboratory'))
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const safari = /Version\/[\d.]+.*Safari\//.test(navigator.userAgent)
const useRedirect = ios || safari
const managedDrive = import.meta.env.VITE_DRIVE_SESSION === 'managed'
const managedLoginError = (() => {
  if (!managedDrive) return ''
  const url = new URL(window.location.href)
  const result = url.searchParams.get('drive')
  if (!result) return ''
  url.searchParams.delete('drive')
  window.history.replaceState(window.history.state, '', url.href)
  if (result === 'connected') return ''
  if (result === 'account') return 'Esta cuenta de Google no tiene acceso a la biblioteca.'
  if (result === 'cancelled') return 'Se canceló la conexión con Google.'
  return 'Google no pudo completar la conexión. Vuelve a intentarlo.'
})()
const session = new GoogleSession(clientId, {
  redirectUri: new URL(import.meta.env.BASE_URL, window.location.origin).href,
  useRedirect,
  sessionPath: managedDrive ? import.meta.env.BASE_URL + 'session/' : undefined,
})
const library = new DriveLibrary(session)
const emptyStudy: StudyState = { favorites: {}, positions: {}, annotations: {} }
const subscribeIdle = () => () => {}
const getEmptyStudy = () => emptyStudy

type View = { page: 'home' | 'general' | 'favorites' | 'recent' | 'review' | 'search' | 'inap' | 'lab' }
  | { page: 'block' | 'topic'; id: string }
  | { page: 'resource'; id: string; version?: string; initialPage?: number; position?: PdfReadingPosition; query?: string; sectionId?: string }
type ListLocation = { view: View; scroll: number }
type ReaderLocation = {
  accountId: string; view: Extract<View, { page: 'resource' }>; version: string;
  back: ListLocation; filters: typeof emptyFilters; query: string; updatedAt?: string;
}
type Modal = { kind: 'add' | 'import' | 'settings'; resource?: never }
  | { kind: 'edit' | 'manage' | 'trash' | 'versions'; resource: Resource }
type Revision = Awaited<ReturnType<DriveLibrary['revisions']>>[number]
type RevisionList = { items?: Revision[]; error?: string }
const mainNav = [
  { page: 'home', label: 'Inicio', icon: LayoutGrid },
  { page: 'general', label: 'General', icon: FolderOpen },
  { page: 'favorites', label: 'Favoritos', icon: Star },
  { page: 'recent', label: 'Recientes', icon: Clock3 },
] as const
const tones = ['cobalt', 'slate', 'violet', 'ochre']
const tailabsUrl = 'https://tailabs.es/app/exams/tailabs'
const emptyFilters = { kind: '', source: '', tag: '' }
const readerLocationKey = 'tai-hub.reader-location.v1'
const labViewKey = 'tai-hub.lab-view.v1'
const searchBatch = 80
const initialSearchLimits = { resources: searchBatch, pages: searchBatch }
const emptyPageResults = { query: '', documents: '', hits: [] as PdfSearchHit[] }

function readReaderLocation(returnTo?: string): ReaderLocation | undefined {
  try {
    const saved = JSON.parse(returnTo ?? sessionStorage.getItem(readerLocationKey) ?? 'null') as ReaderLocation | null
    if (saved?.view?.page === 'resource' && typeof saved.view.id === 'string'
      && typeof saved.accountId === 'string' && typeof saved.version === 'string'
      && saved.back?.view && Number.isFinite(saved.back.scroll) && saved.filters && typeof saved.query === 'string'
      && (saved.updatedAt === undefined || (typeof saved.updatedAt === 'string' && Number.isFinite(Date.parse(saved.updatedAt))))
      && (saved.view.position === undefined || isPdfReadingPosition(saved.view.position))) return saved
  } catch { /* Browser storage unavailable or the saved reader location is invalid. */ }
}

function materialPdfPosition(sectionId: string, resource: Resource, previous?: PdfReadingPosition & { version: string }): PdfReadingPosition | undefined {
  const match = /^pdf-page:([1-9]\d*)$/.exec(sectionId)
  const page = match ? Number(match[1]) : undefined
  if (page !== undefined && Number.isSafeInteger(page)) return { page }
  return previous?.version === resource.version ? previous : undefined
}

export default function App() {
  const official = useOfficialInap()
  const auth = useSyncExternalStore(session.subscribe, session.snapshot)
  const [verifiedAccess, setVerifiedAccess] = useState<AbortSignal>()
  const connected = auth.status === 'connected' && !!verifiedAccess && !verifiedAccess.aborted
  const [account, setAccount] = useState<Awaited<ReturnType<DriveLibrary['account']>>>()
  const [resources, setResources] = useState<Resource[]>([])
  const [catalogueReady, setCatalogueReady] = useState(false)
  const [catalogueRetry, setCatalogueRetry] = useState(0)
  const [catalogueError, setCatalogueError] = useState('')
  const [sync, setSync] = useState<StudySync>()
  const [index, setIndex] = useState<PdfIndex>()
  const [indexTick, setIndexTick] = useState(0)
  const [indexWorking, setIndexWorking] = useState(false)
  const [indexError, setIndexError] = useState('')
  const [indexRun, setIndexRun] = useState(0)
  const [network, setNetwork] = useState(navigator.onLine)
  const [view, setView] = useState<View>(() => {
    if (useRedirect || managedDrive) {
      try {
        const remembered = session.localAccountId()
        if (remembered && sessionStorage.getItem(labViewKey) === remembered) return { page: 'lab' }
      } catch { /* Study remains reachable from the menu. */ }
    }
    return { page: 'home' }
  })
  const [back, setBack] = useState<ListLocation>({ view: { page: 'home' }, scroll: 0 })
  const [filters, setFilters] = useState(emptyFilters)
  const [query, setQuery] = useState('')
  const [searchLimits, setSearchLimits] = useState(initialSearchLimits)
  const [pageResults, setPageResults] = useState(emptyPageResults)
  const [searchError, setSearchError] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [modal, setModal] = useState<Modal>()
  const [material, setMaterial] = useState<{ resource: Resource; sectionId: string }>()
  const [revisions, setRevisions] = useState<RevisionList>({})
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(managedLoginError)
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('tai-theme') || 'system' }
    catch { return 'system' }
  })
  const search = useRef<HTMLInputElement>(null)
  const nextScroll = useRef(0)
  const verifiedAccount = useRef<string | undefined>(undefined)
  const pendingRefresh = useRef<AbortSignal | undefined>(undefined)
  const lastCatalogue = useRef<string | undefined>(undefined)
  const restoreReader = useRef(true)
  const readerLocation = useRef<ReaderLocation | undefined>(undefined)
  const study = useSyncExternalStore(sync ? fn => sync.subscribe(fn) : subscribeIdle, sync ? () => sync.snapshot() : getEmptyStudy)
  const studyStatus = useSyncExternalStore(sync?.subscribe ?? subscribeIdle, sync?.status ?? (() => 'idle'))
  const accountId = account?.id
  const labAccountId = view.page === 'lab' ? accountId ?? session.localAccountId() : undefined
  const current = view.page === 'resource' ? resources.find(item => item.id === view.id) : undefined
  const currentVersion = current?.version
  const readingPdf = current?.kind === 'pdf'
  const searching = view.page === 'search'
  const cleanQuery = query.trim()

  useEffect(() => {
    if (clientId && (useRedirect || !session.resume())) void session.prepare()
  }, [])
  useEffect(() => {
    if (!managedDrive) return
    const renew = () => {
      if (document.visibilityState === 'visible') void session.renew()
    }
    const timer = window.setInterval(renew, 30_000)
    document.addEventListener('visibilitychange', renew)
    window.addEventListener('online', renew)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', renew)
      window.removeEventListener('online', renew)
    }
  }, [])
  useEffect(() => {
    if (!useRedirect && !managedDrive) return
    try {
      const remembered = accountId ?? session.localAccountId()
      if (view.page === 'lab' && remembered) sessionStorage.setItem(labViewKey, remembered)
      else sessionStorage.removeItem(labViewKey)
    } catch { /* The current study view is still available. */ }
  }, [view.page, accountId])
  useEffect(() => {
    const remembered = session.localAccountId()
    if (!remembered) return
    let active = true
    void readCatalogue(remembered).then(saved => {
      if (!active || !saved || lastCatalogue.current || session.localAccountId() !== remembered
        || (verifiedAccount.current && verifiedAccount.current !== remembered)) return
      lastCatalogue.current = remembered
      setAccount(saved.account)
      setResources(saved.resources)
      setCatalogueReady(true)
    }).catch(() => {})
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!account || !catalogueReady || lastCatalogue.current !== account.id) return
    void saveCatalogue(account, resources).catch(() => {})
  }, [account, catalogueReady, resources])
  useLayoutEffect(() => { window.scrollTo({ top: nextScroll.current, behavior: 'instant' }) }, [view])
  const rememberReader = useCallback((location?: ReaderLocation) => {
    readerLocation.current = location
    try {
      if (location) sessionStorage.setItem(readerLocationKey, JSON.stringify(location))
      else sessionStorage.removeItem(readerLocationKey)
    } catch { /* StudySync still preserves the reading position. */ }
  }, [])
  useLayoutEffect(() => {
    if (!accountId) return
    if (view.page !== 'resource' || currentVersion === undefined) {
      if (restoreReader.current && view.page === 'home') return
      rememberReader()
      return
    }
    const previous = readerLocation.current
    const sameReader = previous?.accountId === accountId && previous.view.id === view.id && previous.version === currentVersion
    const position = sameReader ? previous.view.position : view.version === currentVersion ? view.position : undefined
    rememberReader({ accountId, version: currentVersion, view: { ...view, position }, back, filters, query,
      updatedAt: sameReader ? previous.updatedAt : undefined })
  }, [accountId, back, currentVersion, filters, query, rememberReader, view])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('tai-theme', theme) } catch { /* Browser storage unavailable. */ }
    const preference = matchMedia('(prefers-color-scheme: dark)')
    const tintBrowser = () => document.querySelector('meta[name="theme-color"]')?.setAttribute('content',
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())
    tintBrowser()
    preference.addEventListener('change', tintBrowser)
    return () => preference.removeEventListener('change', tintBrowser)
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
    restoreReader.current = false
    nextScroll.current = restoreScroll ?? 0
    if (restoreScroll === undefined && next.page !== 'resource') setFilters(emptyFilters)
    setView(next)
    setMaterial(undefined)
    setDrawer(false)
    setNotice('')
    setError('')
  }
  function returnToList() {
    navigate(back.view, back.scroll)
  }
  function connect(sameTab?: boolean) {
    setError('')
    const returnTo = view.page === 'lab' ? 'lab' : readerLocation.current && JSON.stringify(readerLocation.current)
    void session.connect({ sameTab, returnTo }).catch(showError)
  }
  const clearPrivate = useCallback(() => {
    verifiedAccount.current = undefined
    lastCatalogue.current = undefined
    rememberReader()
    setVerifiedAccess(undefined)
    setAccount(undefined)
    setResources([])
    setCatalogueReady(false)
    setCatalogueRetry(0)
    setCatalogueError('')
    setQuery('')
    setSearchLimits(initialSearchLimits)
    setPageResults(emptyPageResults)
    setModal(undefined)
    setMaterial(undefined)
    setFilters(emptyFilters)
    setBack({ view: { page: 'home' }, scroll: 0 })
    nextScroll.current = 0
    setView({ page: 'home' })
    setDrawer(false)
    setError('')
    setNotice('')
  }, [rememberReader])
  const refresh = useCallback(async () => {
    let signal: AbortSignal | undefined
    try { signal = session.access().signal }
    catch (failure) { showError(failure); return }
    if (pendingRefresh.current === signal) return
    pendingRefresh.current = signal
    setWorking(true)
    const listing = library.list().then(items => ({ items }), (failure: unknown) => ({ failure }))
    try {
      const user = await library.account()
      signal.throwIfAborted()
      const previousAccount = verifiedAccount.current ?? lastCatalogue.current
      if (previousAccount && previousAccount !== user.id) clearPrivate()
      verifiedAccount.current = user.id
      setAccount(user)
      setVerifiedAccess(signal)
      setError('')
      const returnTo = session.takeReturnLocation()
      if (returnTo === 'lab') setView({ page: 'lab' })
      const result = await listing
      signal.throwIfAborted()
      if ('failure' in result) {
        setCatalogueError('No se pudo actualizar la biblioteca desde Drive.')
        if (result.failure instanceof DriveError && [0, 429, 500, 502, 503, 504].includes(result.failure.status)) {
          setCatalogueRetry(count => count + 1)
        }
        return
      }
      const { items } = result
      lastCatalogue.current = user.id
      setResources(items)
      setCatalogueReady(true)
      setCatalogueRetry(0)
      setCatalogueError('')
      if (returnTo !== 'lab' && (returnTo || restoreReader.current)) {
        const saved = readReaderLocation() ?? (returnTo ? readReaderLocation(returnTo) : undefined)
        const resource = saved && items.find(item => item.id === saved.view.id)
        if (saved?.accountId === user.id && resource) {
          if (saved.version === resource.version) rememberReader(saved)
          setView(saved.version === resource.version ? { ...saved.view, version: resource.version }
            : { page: 'resource', id: resource.id, version: resource.version })
          setBack(saved.back)
          setFilters(saved.filters)
          setQuery(saved.query)
        }
      }
      restoreReader.current = false
    } catch (failure) {
      if (!signal.aborted) {
        showError(failure)
        if (failure instanceof DriveError && [0, 429, 500, 502, 503, 504].includes(failure.status)) {
          setCatalogueRetry(count => count + 1)
        }
      }
    } finally {
      if (pendingRefresh.current === signal) {
        pendingRefresh.current = undefined
        setWorking(false)
      }
    }
  }, [clearPrivate, rememberReader])
  useEffect(() => {
    if (auth.status === 'connected' && network && !connected) void refresh()
    if (auth.status === 'ready' && (verifiedAccount.current || lastCatalogue.current) && !session.localAccountId()) clearPrivate()
    if (!useRedirect && auth.status === 'expired' && !verifiedAccount.current && view.page !== 'lab') session.resume()
  }, [auth, connected, network, refresh, clearPrivate, view.page])
  useEffect(() => {
    if (!network || auth.status !== 'connected' || catalogueRetry === 0) return
    const timer = setTimeout(() => { void refresh() }, Math.min(60_000, 2_000 * 2 ** (catalogueRetry - 1)))
    return () => clearTimeout(timer)
  }, [auth.status, catalogueRetry, network, refresh])
  useEffect(() => {
    if (useRedirect || view.page !== 'home' || modal) return
    const resumeOnReturn = () => {
      if (document.visibilityState === 'visible' && session.snapshot().status === 'expired') session.resume()
    }
    document.addEventListener('visibilitychange', resumeOnReturn)
    return () => document.removeEventListener('visibilitychange', resumeOnReturn)
  }, [view.page, modal])

  useEffect(() => {
    if (!accountId) { setSync(undefined); setIndex(undefined); return }
    const nextSync = new StudySync(library, accountId)
    setSync(nextSync)
    void nextSync.load()
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
    let active = true
    void sync.refresh().then(() => {
      // An immediate reload can interrupt IndexedDB. Recover the tab's reading point
      // after checking Drive so an older tab cannot overwrite newer reading progress.
      const saved = readerLocation.current
      if (!active || !saved?.updatedAt || saved.accountId !== accountId || !saved.view.position) return
      const previous = sync.snapshot().positions[saved.view.id]
      if (!previous || previous.openedAt < saved.updatedAt) {
        return sync.apply({ kind: 'position', resourceId: saved.view.id, value: {
          ...saved.view.position, version: saved.version, openedAt: saved.updatedAt,
        } })
      }
    }).catch(() => {})
    return () => { active = false }
  }, [sync, connected, accountId])

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
  function markOpened(resource: Resource, position: PdfReadingPosition, openedAt = new Date().toISOString()) {
    apply({ kind: 'position', resourceId: resource.id, value: { ...position, version: resource.version, openedAt } })
  }
  function recordReadingPosition(resource: Resource, position: PdfReadingPosition) {
    const saved = readerLocation.current
    const updatedAt = new Date().toISOString()
    if (saved?.accountId === accountId && saved?.view.id === resource.id && saved.version === resource.version) {
      rememberReader({ ...saved, view: { ...saved.view, position }, updatedAt })
    }
    markOpened(resource, position, updatedAt)
  }
  function open(resource: Resource, page?: number, highlight?: string, sectionId?: string) {
    search.current?.blur()
    const previous = study.positions[resource.id]
    const position: PdfReadingPosition = page !== undefined ? { page }
      : previous?.version === resource.version && isPdfReadingPosition(previous) ? previous : { page: 1 }
    if (view.page !== 'resource') setBack({ view, scroll: window.scrollY })
    markOpened(resource, resource.kind === 'pdf' ? position : { page: 0 })
    navigate({ page: 'resource', id: resource.id, version: resource.version, position, query: highlight, sectionId })
  }
  function favorite(resource: Resource) {
    apply({ kind: 'favorite', resourceId: resource.id, value: !study.favorites[resource.id] })
  }
  function download(resource: Resource, revisionId?: string) {
    void library.download(resource, revisionId).catch(showError)
  }
  async function save(draft: ResourceDraft, file?: File, replacement?: File, progress?: (done: number, total: number) => void) {
    if (modal?.resource) {
      const updated = replacement
        ? await library.replace(modal.resource.id, replacement, draft, progress)
        : await library.update(modal.resource.id, draft)
      setResources(items => items.map(item => item.id === updated.id ? updated : item))
    } else {
      const created = await library.create(draft, file, progress)
      setResources(items => [...items, created])
    }
    setModal(current => current === modal ? undefined : current)
    setNotice('Recurso guardado en Drive.')
  }
  function versions(resource: Resource) {
    const request: RevisionList = {}
    setRevisions(request)
    setError('')
    setModal({ kind: 'versions', resource })
    void library.revisions(resource.id)
      .then(items => setRevisions(current => current === request ? { items } : current))
      .catch(failure => setRevisions(current => current === request ? {
        error: failure instanceof Error ? failure.message : 'No se pudieron consultar las versiones.',
      } : current))
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
  const expandedNotes = topic ? visible.find(item => item.kind === 'html' && item.tags.includes('Apuntes ampliados')) : undefined
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
    review: 'Por revisar', search: 'Búsqueda', resource: current?.title ?? 'Recurso', topic: 'Tema', block: 'Bloque', inap: 'INAP y BOE', lab: 'Laboratorio TAI',
  })[view.page]
  const listProps = { open, favorite, study, index, connected }
  const loadingLibrary = !catalogueReady && !!clientId && !error && network
    && (['loading', 'connecting'].includes(auth.status) || working)
  const showConnect = !account && !loadingLibrary && network
  const libraryStatus = !network ? 'Sin conexión.' : catalogueError || (error ? 'La biblioteca no se pudo cargar.' : 'Cargando biblioteca…')
  const retryLibrary = auth.status === 'connected'
  const connectLabel = retryLibrary ? loadingLibrary ? libraryStatus : 'Reintentar'
    : loadingLibrary ? 'Conectando…' : 'Conectar Google Drive'
  const indexLabel = !indexStats.indexed && indexStats.pending
    ? 'Preparando la búsqueda en PDF…' : `${indexStats.indexed} PDF indexados`
  const inapLabel = official.unread ? 'Convocatorias INAP, novedades disponibles' : 'Convocatorias INAP'
  const officialView = view.page === 'inap'

  return <div className="app-shell">
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <span className="sr-only" role="status">{official.unread && 'Hay novedades de INAP y BOE.'}</span>
    {drawer && <button className="scrim" aria-label="Cerrar navegación" onClick={() => setDrawer(false)} />}
    <aside className={drawer ? 'sidebar sidebar-open' : 'sidebar'} aria-label="Navegación principal">
      <button className="brand" onClick={() => navigate({ page: 'home' })}>
        <img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" width="42" height="42" />
        <span><strong>TAI Hub</strong><small>Estudio personal</small></span>
      </button>
      <nav className="nav-primary">
        {mainNav.map(({ page, label, icon: Icon }) => <button key={page} aria-current={view.page === page ? 'page' : undefined}
          onClick={() => navigate({ page })}><Icon size={18} /> {label}</button>)}
        <button aria-current={view.page === 'lab' ? 'page' : undefined} onClick={() => navigate({ page: 'lab' })}><BookOpen size={18} /> Laboratorio TAI</button>
        {(reviewCount > 0 || view.page === 'review') && <button aria-current={view.page === 'review' ? 'page' : undefined} onClick={() => navigate({ page: 'review' })}><List size={18} /> Por revisar <span className="nav-count">{reviewCount}</span></button>}
        <button aria-current={officialView ? 'page' : undefined} aria-label={inapLabel}
          onClick={() => navigate({ page: 'inap' })}><InapIcon unread={official.unread} /> Convocatorias INAP</button>
        <a href={tailabsUrl} target="_blank" rel="noreferrer" onClick={() => setDrawer(false)}><ClipboardList size={18} /> Tests de Tailabs <ExternalLink className="nav-external" size={14} /></a>
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
          <Search size={20} /><input ref={search} value={query} placeholder="Buscar en biblioteca" aria-label="Buscar en la biblioteca" onChange={event => {
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
        {!network && <div className="banner" role="status"><CloudOff size={18} /> Sin conexión. {account && !officialView && 'El progreso pendiente se sincronizará al recuperar el acceso a Drive.'}</div>}
        {!officialView && (account || labAccountId) && !connected && <div className="banner" role="status"><CloudOff size={18} />
          <span>{auth.status === 'connecting' || working ? 'Recuperando acceso a Drive…' : 'Reconecta Drive para actualizar la biblioteca y sincronizar.'}</span>
          <button className="button" disabled={!network || auth.status === 'loading' || auth.status === 'connecting' || working}
            onClick={() => auth.status === 'connected' ? void refresh() : connect()}>{auth.status === 'connected' ? 'Reintentar' : 'Reconectar'}</button></div>}
        {!officialView && (error || (auth.status === 'error' && auth.error)) && <div className="banner error" role="alert"><span>{error || auth.error}</span>
          {!ios && !safari && auth.status === 'error' && <button className="button" onClick={() => connect(true)}>Conectar en esta pestaña</button>}
          {error && <button className="icon-button" aria-label="Cerrar aviso" onClick={() => setError('')}><X size={17} /></button>}
        </div>}
        {!officialView && view.page !== 'lab' && catalogueError && <div className="banner" role="status">{catalogueError}
          <button className="button" disabled={working || !connected || !network} onClick={() => void refresh()}>Actualizar biblioteca</button></div>}
        {notice && <div className="banner success" role="status"><span>{notice}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setNotice('')}><X size={17} /></button></div>}
        {view.page === 'home' ? <>
          <div className="page-heading"><p className="context-label"><LibraryBig size={17} /> TAI AGE · Acceso libre</p><h1>Biblioteca de estudio</h1></div>
          <section className="hero" aria-label={account && !loadingLibrary ? 'Continuar estudio' : 'Conexión con Google Drive'}>
            <div className="hero-copy">
              <span className="hero-kicker">{account ? <><BookOpen size={16} /> {recent[0] ? 'Último recurso' : 'Biblioteca privada'}</> : <><LockKeyhole size={15} /> Biblioteca privada</>}</span>
              <h2>{account ? recent[0]?.title ?? (resources.length ? `${resources.length} recursos` : 'Añadir el primer recurso') : 'Google Drive'}</h2>
              <p>{account
                ? recent[0] ? locationName(recent[0].topicId) : resources.length ? indexLabel : 'Puedes añadir archivos, enlaces y notas.'
                : 'Conecta tu cuenta para consultar la biblioteca y sincronizar el progreso.'}</p>
              {account && recent[0] ? <button className="hero-button" onClick={() => open(recent[0])}>Abrir último recurso <ArrowRight size={17} /></button>
                : account && resources.length ? <a className="hero-button" href="#temario">Ver temario <ChevronRight size={17} /></a>
                : account ? <button className="hero-button" disabled={!connected} onClick={() => setModal({ kind: 'add' })}><Plus size={17} /> Añadir recurso</button>
                  : <button className="hero-button" disabled={!clientId || !showConnect || working}
                    onClick={() => retryLibrary ? void refresh() : connect()}><Cloud size={18} />
                    {connectLabel}<ArrowRight size={17} /></button>}
              {!clientId && <p className="hero-note">Falta configurar el Client ID público.</p>}
            </div>
            <HeroArt />
          </section>
          <div className="study-links" aria-label="Accesos de estudio">
            <button className={official.unread ? 'shortcut shortcut-unread' : 'shortcut'} onClick={() => navigate({ page: 'inap' })}>
              <InapIcon unread={official.unread} /><span>{official.unread ? 'Novedades de INAP' : 'Convocatorias'}</span><ChevronRight size={16} />
            </button>
            <a className="shortcut" href={tailabsUrl} target="_blank" rel="noreferrer">
              <ClipboardList size={19} /><span>Tests de Tailabs</span><ExternalLink size={15} />
            </a>
          </div>
          <section className="section" id="temario">
            <div className="section-head"><div><h2>Temario oficial</h2><p>4 bloques · 33 temas</p></div>
              <a href={syllabusSource} target="_blank" rel="noreferrer" className="text-link">Ver programa en el BOE <ExternalLink size={15} /></a></div>
            <div className="block-grid">{blocks.map((item, i) => <button className="block-card" key={item.id} onClick={() => navigate({ page: 'block', id: item.id })}>
              <span className={`block-number ${tones[i]}`}>{item.roman}</span><span><strong>{item.title}</strong><small>{item.topics.length} temas</small></span><ChevronRight size={18} />
            </button>)}</div>
          </section>
          <section className="section"><div className="section-head"><h2>Accesos rápidos</h2></div>
            <div className="shortcut-grid">{mainNav.slice(1).map(({ page, label, icon: Icon }) => <button key={page} className="shortcut" onClick={() => navigate({ page })}><Icon size={19} /> {label}<ChevronRight size={16} /></button>)}</div>
          </section>
        </> : view.page === 'lab' ? <Suspense fallback={<p>Cargando laboratorio…</p>}><Laboratory library={library} accountId={labAccountId} connected={connected}
          openMaterial={(id, sectionId) => {
            const resource = resources.find(r => r.id === id || (id.startsWith('import:') && r.importKey === id.slice(7)))
            if (resource) setMaterial({ resource, sectionId })
            else setError('El material no está disponible en esta biblioteca.')
          }} /></Suspense>
        : officialView ? <OfficialInap {...official} /> : view.page === 'search' ? <>
          <div className="page-heading"><p className="context-label"><Search size={17} /> Biblioteca</p><h1>Búsqueda</h1><p>Busca por título, fuente y texto dentro de los PDF.</p></div>
          {loadingLibrary || (retryLibrary && !account) ? <div className="empty" role="status"><Cloud size={24} /><p>{libraryStatus}</p></div>
            : <SearchResults query={cleanQuery} pageResults={pageResults.documents === pdfVersions ? pageResults : emptyPageResults} error={searchError} resources={resources}
            limits={searchLimits} loadMore={kind => setSearchLimits(current => ({ ...current, [kind]: current[kind] + searchBatch }))}
            indexing={indexWorking} hasAccount={!!account} open={open} />}
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
          {current.kind === 'pdf'
            ? <PdfPane key={`${current.id}:${current.version}`} resource={current} access={verifiedAccess}
              position={view.version === current.version ? view.position ?? { page: view.initialPage ?? 1 } : undefined} query={view.query}
              annotations={study.annotations[current.id]?.[current.version] ?? []}
              onPosition={position => recordReadingPosition(current, position)}
              apply={apply} reconnect={() => connect()} download={() => library.download(current)} />
            : <ResourceView key={`${current.id}:${current.version}`} resource={current} library={library} connected={connected} sectionId={view.sectionId} download={() => download(current)} />}
        </> : <>
          {block && <button className="text-link back-link" onClick={() => navigate(topic ? { page: 'block', id: block.id } : { page: 'home' })}>
            <ArrowLeft size={17} /> {topic ? `Bloque ${block.roman}` : 'Biblioteca'}</button>}
          <div className="page-heading"><p className="context-label">{topic ? `Bloque ${topic.block.roman} · Tema ${topic.number}` : block ? `Bloque ${block.roman}` : 'Biblioteca'}</p>
            <h1>{title}</h1><p>{topic?.description ?? (block ? `${block.topics.length} temas del programa oficial` :
              view.page === 'general' ? 'Convocatorias, exámenes y materiales transversales.' :
              view.page === 'favorites' ? 'Recursos que has guardado para volver a consultar.' :
              view.page === 'review' ? 'Aquí aparecen los recursos marcados como pendientes de revisión. Abre la ficha para comprobar su ubicación y quitar la marca.' : 'Últimos recursos que has consultado.')}</p></div>
          {expandedNotes && <div className="actions"><button className="button primary" onClick={() => open(expandedNotes)}>Apuntes ampliados</button></div>}
          {view.page === 'block' && block ? <div className="topic-list">
            {block.topics.map(item => <button key={item.id} onClick={() => openLocation(item.id)}>
              <span className={`block-number ${tones[blocks.indexOf(block)]}`}>{item.number}</span>
              <span><strong>{item.title}</strong>{account && <small>{resources.filter(resource => resource.topicId === item.id || resource.relatedTopicIds?.includes(item.id)).length} recursos</small>}</span><ChevronRight size={18} />
            </button>)}
          </div> : loadingLibrary ? <div className="empty" role="status"><Cloud size={24} /><p>{libraryStatus}</p></div>
            : <ResourceList items={visible} filters={filters} setFilters={setFilters} {...listProps}
              empty={account ? view.page === 'review' ? 'No quedan recursos pendientes de revisión.' : 'Todavía no hay recursos en esta sección.'
                : showConnect && !retryLibrary ? 'Conecta Google Drive para ver tus recursos.' : libraryStatus}
              review={view.page === 'review' ? resource => setModal({ kind: 'edit', resource }) : undefined}
              onEmpty={showConnect && clientId ? () => retryLibrary ? void refresh() : connect() : connected && (topic || view.page === 'general') ? () => setModal({ kind: 'add' }) : undefined}
              emptyAction={showConnect ? retryLibrary ? 'Reintentar' : 'Conectar Drive' : 'Añadir recurso'} />}
        </>}
      </main>

      <nav className="mobile-nav" aria-label="Accesos principales">
        {mainNav.map(({ page, label, icon: Icon }) => <button key={page} aria-current={view.page === page ? 'page' : undefined} onClick={() => navigate({ page })}><Icon size={19} />{label}</button>)}
        <button aria-current={officialView ? 'page' : undefined} aria-label={inapLabel} onClick={() => navigate({ page: 'inap' })}>
          <InapIcon unread={official.unread} /> INAP
        </button>
      </nav>
    </div>

    {material && <Dialog title={material.resource.title} wide className="study-material-dialog" closeLabel="Volver al estudio" preserveScroll onClose={() => setMaterial(undefined)}>
      {material.resource.kind === 'pdf'
        ? <PdfPane resource={material.resource} access={verifiedAccess}
          position={materialPdfPosition(material.sectionId, material.resource, study.positions[material.resource.id])}
          annotations={study.annotations[material.resource.id]?.[material.resource.version] ?? []}
          onPosition={position => markOpened(material.resource, position)} apply={apply}
          reconnect={() => connect()} download={() => library.download(material.resource)} />
        : <ResourceView resource={material.resource} library={library} connected={connected} sectionId={material.sectionId}
          download={() => download(material.resource)} inDialog />}
    </Dialog>}

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
        {revisions.error ? <p role="alert" className="form-error">{revisions.error}</p>
          : !revisions.items ? <p role="status">Consultando Drive…</p> : !revisions.items.length ? <p>No hay versiones anteriores conservadas.</p> :
            revisions.items.map((revision, i) => <div className="revision" key={revision.id}><span>{revision.modifiedTime ? new Date(revision.modifiedTime).toLocaleString('es') : `Revisión ${i + 1}`}</span>
            <button className="button" onClick={() => modal.resource && download(modal.resource, revision.id)}><Download size={16} /> Descargar</button></div>)}</div>}
      {modal.kind === 'settings' && <div className="settings-panel">
        <section><h3>Apariencia</h3><div className="segmented">{[['system', 'Sistema', Settings2], ['light', 'Claro', Sun], ['dark', 'Oscuro', Moon]].map(([value, label, Icon]) => {
          const ThemeIcon = Icon as typeof Sun
          return <button type="button" key={String(value)} aria-pressed={theme === value} onClick={() => setTheme(String(value))}><ThemeIcon size={16} />{String(label)}</button>
        })}</div></section>
        <section><h3>Google Drive</h3><p>{account ? `${account.name} · ${connected ? 'Conectado' : 'Acceso caducado'}` : 'Conecta tu biblioteca privada.'}</p>
          {account && <p>{account.storage.limit !== undefined ? `${bytes(Math.max(0, account.storage.limit - account.storage.usage))} disponibles en Drive` : ''}</p>}
          {account && studyStatus !== 'idle' && <p role="status">{studyStatus === 'syncing' ? 'Sincronizando el progreso…' : 'Progreso guardado en este dispositivo. Pendiente de sincronizar.'}</p>}
          {error && <p role="alert" className="form-error">{error}</p>}
          <div className="actions">{connected && account ? <>
            <button className="button" disabled={working} onClick={() => { void refresh(); void sync?.refresh().catch(showError) }}><RefreshCw size={16} /> Actualizar</button>
            <button className="button" onClick={() => setModal({ kind: 'import' })}><Upload size={16} /> Importar carpeta</button>
          </> : <button className="button primary" disabled={!clientId || !network || auth.status === 'loading' || auth.status === 'connecting' || working}
            onClick={() => auth.status === 'connected' ? void refresh() : connect()}><Cloud size={17} /> {auth.status === 'connected' ? 'Reintentar' : 'Conectar Drive'}</button>}
            {(account || session.localAccountId() || auth.status === 'connected') && <button className="button" onClick={() => {
              void session.signOut().then(clearPrivate).catch(showError)
            }}><LogOut size={16} /> Desconectar</button>}
          </div>
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

function InapIcon({ unread }: { unread: boolean }) {
  return <span className="inap-icon" aria-hidden="true"><Landmark size={18} />{unread && <span className="inap-dot" />}</span>
}

function HeroArt() {
  return <svg className="hero-art" viewBox="0 0 420 250" fill="none" aria-hidden="true">
    <defs><pattern id="hero-grid" width="21" height="21" patternUnits="userSpaceOnUse"><path d="M21 0H0v21" stroke="currentColor" opacity=".2"/></pattern></defs>
    <path d="M32 0h388v250H32z" fill="url(#hero-grid)" />
    <g stroke="currentColor" strokeWidth="1.5" opacity=".8" strokeLinejoin="round">
      <path d="M106 107l111-59 123 66-112 66z" fill="var(--accent-soft)" />
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
function ResourceList({ items, open, favorite, study, index, connected, filters, setFilters, empty, onEmpty, emptyAction, review }: ListProps & {
  items: Resource[]; empty: string; onEmpty?: () => void; emptyAction: string
  filters: typeof emptyFilters; setFilters: (filters: typeof emptyFilters) => void
  review?: (resource: Resource) => void
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
            {review && <span className="review-reason">{item.tags.some(tag => fold(tag) === 'gsi')
              ? 'Material de GSI. Confirma qué parte te sirve para TAI.'
              : item.tags.some(tag => fold(tag) === 'transversal') ? 'Cubre varios temas. Confirma su ubicación.'
                : 'Confirma el tema y los datos de la ficha.'}</span>}
            {item.tags.length > 0 && <span className="tag-list">{item.tags.map(label => <span key={label}>{label}</span>)}</span>}</span></button>
        {review ? <button className="button review-button" disabled={!connected} aria-label={`Revisar ficha de ${item.title}`} onClick={() => review(item)}>Revisar ficha</button>
          : <button className="icon-button" aria-pressed={!!study.favorites[item.id]} aria-label={study.favorites[item.id] ? 'Quitar de favoritos' : 'Guardar en favoritos'} onClick={() => favorite(item)}><Star size={19} className={study.favorites[item.id] ? 'filled' : ''} /></button>}
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
    {found.length > 0 && <section><h2>Recursos <small>{found.length}</small></h2><div className="resource-list">
      {found.slice(0, limits.resources).map(item => { const Icon = kinds[item.kind].icon; return <button className="search-item" key={item.id} onClick={() => open(item)}>
        <span className={`file-icon kind-${item.kind}`}><Icon size={19} /></span><span><strong>{item.title}</strong><small>{locationName(item.topicId)} · {item.source}</small></span><ChevronRight size={18} />
      </button> })}
    </div>{found.length > limits.resources && <div className="actions"><button className="button" onClick={() => loadMore('resources')}>Mostrar más recursos</button></div>}</section>}
    {hits.length > 0 && <section><h2>Dentro de PDF <small>{morePages ? `${limits.pages}+` : hits.length}</small></h2><div className="resource-list">
      {hits.slice(0, limits.pages).map(hit => { const item = byId.get(hit.id)!; return <button className="search-item" key={`${hit.id}:${hit.page}`} onClick={() => open(item, hit.page, query)}>
        <span className="file-icon kind-pdf"><FileSearch size={19} /></span>
        <span><strong>{item.title}</strong><small>{locationName(item.topicId)} · Página {hit.page}{item.source && ` · ${item.source}`}</small><SearchSnippet hit={hit} /></span><ChevronRight size={18} />
      </button> })}
    </div>{morePages && <div className="actions"><button className="button" onClick={() => loadMore('pages')}>Mostrar más páginas</button></div>}</section>}
    {!found.length && !hits.length && !indexing && pageResults.query === query && <div className="empty"><FileSearch size={25} /><p>No hay coincidencias para «{query}».</p></div>}
    {indexing && <p className="form-hint" role="status">Índice en actualización. Irán apareciendo más páginas.</p>}
    {error && <p className="form-error" role="alert">La búsqueda de páginas no se pudo completar.</p>}
  </div>
}

function SearchSnippet({ hit }: { hit: PdfSearchHit }) {
  const { snippet, terms } = hit
  const ranges = matchRanges(snippet, terms)
  return <span className="snippet">{ranges.map(({ start, end }, index) => <Fragment key={start}>
    {snippet.slice(ranges[index - 1]?.end ?? 0, start)}<mark>{snippet.slice(start, end)}</mark>
  </Fragment>)}{snippet.slice(ranges.at(-1)?.end ?? 0)}</span>
}

type ReaderAnnotations = StudyState['annotations'][string][string]
function PdfPane({ resource, access, position, query, annotations, onPosition, apply, download, reconnect }: {
  resource: Resource; position?: PdfReadingPosition; query?: string; annotations: ReaderAnnotations
  access?: AbortSignal
  onPosition: (position: PdfReadingPosition) => void; apply: (patch: StudyPatch) => void
  download: () => Promise<void>; reconnect: () => void
}) {
  const source = useMemo(() => {
    if (!access || access.aborted) return undefined
    try { return { ...library.pdfSource(resource.id), byteLength: resource.size } }
    catch { return undefined }
  }, [access, resource.id, resource.version, resource.size])
  if (!source) return <div className="empty"><CloudOff size={24} /><p>Renueva el acceso a Drive para abrir el PDF.</p>
    <a className="button" href={library.viewUrl(resource)} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Abrir en Drive</a></div>
  return <Suspense fallback={<div className="empty" role="status">Abriendo lector…</div>}>
    <PdfReader source={source} initialPosition={position} initialQuery={query} annotations={annotations} originalUrl={driveLink(resource)}
      onPositionChange={onPosition} onDownload={download} onReconnect={reconnect}
      onAnnotationAdd={value => apply({ kind: 'annotation', resourceId: resource.id, version: resource.version, annotationId: value.id, value })}
      onAnnotationRemove={annotationId => apply({ kind: 'annotation', resourceId: resource.id, version: resource.version, annotationId, value: null })} />
  </Suspense>
}
