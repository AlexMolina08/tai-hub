import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from 'react'
import { Bookmark, ChevronLeft, ChevronRight, CornerDownLeft, Download, ExternalLink, Highlighter, Maximize2, Minus, Plus, Search, StickyNote, Trash2, X } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import { openPdf, pdfErrorMessage } from '../pdf/document'
import { uncoveredHighlightRects } from '../pdf/highlights'
import { pdfAccessDenied } from '../pdf/range'
import type { PdfAnnotation, PdfReadingPosition, PdfSource } from '../pdf/model'
import { PdfPages } from '../pdf/PdfPages'
import type { PdfPageNavigation } from '../pdf/PdfPages'
import type { PdfSelection } from '../pdf/PageCanvas'
import { contextualSnippet, foldWord, isTextItem, queryWords, textRuns } from '../pdf/text'
import './pdf-reader.css'

export type { PdfAnnotation, PdfSource } from '../pdf/model'

export interface PdfReaderProps {
  source: PdfSource
  initialPosition?: PdfReadingPosition
  initialQuery?: string
  annotations: PdfAnnotation[]
  onPositionChange: (position: PdfReadingPosition) => void
  onAnnotationAdd: (annotation: PdfAnnotation) => void
  onAnnotationRemove: (id: string) => void
  onDownload: () => Promise<void>
  onReconnect?: () => void
  originalUrl?: string
}

interface LocalMatch {
  page: number
  text: string
}

type AnnotationChange = { annotations: PdfAnnotation[]; added: boolean }
const annotationNames = { bookmark: 'marcador', note: 'nota', highlight: 'subrayado' }

export default function PdfReader({
  source, initialPosition = { page: 1 }, initialQuery = '', annotations, onPositionChange,
  onAnnotationAdd, onAnnotationRemove, onDownload, onReconnect, originalUrl,
}: PdfReaderProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>()
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [streamFallback, setStreamFallback] = useState(false)
  const [page, setPage] = useState(initialPosition.page)
  const [pageInput, setPageInput] = useState(String(initialPosition.page))
  const [zoom, setZoom] = useState(initialPosition.zoom ?? 1)
  const [width, setWidth] = useState(0)
  const [selection, setSelection] = useState<PdfSelection>()
  const [readingMode, setReadingMode] = useState(initialPosition.readingMode ?? false)
  const [highlightHelp, setHighlightHelp] = useState(false)
  const [editFeedback, setEditFeedback] = useState('')
  const [history, setHistory] = useState<{ undo: AnnotationChange[]; redo: AnnotationChange[] }>({ undo: [], redo: [] })
  const [query, setQuery] = useState(initialQuery)
  const [activeQuery, setActiveQuery] = useState(initialQuery)
  const [matches, setMatches] = useState<LocalMatch[]>([])
  const [searchStatus, setSearchStatus] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftPage, setDraftPage] = useState<number>()
  const [searching, setSearching] = useState(false)
  const searchRun = useRef(0)
  const reader = useRef<HTMLElement>(null)
  const modeToggle = useRef<HTMLButtonElement>(null)
  const searchToggle = useRef<HTMLButtonElement>(null)
  const notesToggle = useRef<HTMLButtonElement>(null)
  const searchField = useRef<HTMLInputElement>(null)
  const downloadButton = useRef<HTMLButtonElement>(null)
  const restoreModeFocus = useRef(false)
  const scroll = useRef<HTMLDivElement>(null)
  const pointerStart = useRef<{ x: number; y: number; type: string; at: number } | null>(null)
  const navigation = useRef<PdfPageNavigation>(null)
  const activePage = useRef(initialPosition.page)
  const position = useRef(initialPosition)
  const savedPosition = useRef(initialPosition)
  const saveTimer = useRef<number | undefined>(undefined)
  const settings = useRef({ zoom, readingMode })
  const reportPosition = useRef(onPositionChange)
  useLayoutEffect(() => { reportPosition.current = onPositionChange }, [onPositionChange])
  const url = source.url
  const data = source.data
  const byteLength = source.byteLength
  const headerKey = JSON.stringify(source.httpHeaders ?? {})

  const savePosition = useCallback(() => {
    clearTimeout(saveTimer.current)
    const next = position.current
    if (samePosition(next, savedPosition.current)) return
    savedPosition.current = next
    reportPosition.current(next)
  }, [])

  const moveTo = useCallback((anchor: PdfReadingPosition) => {
    const next = { ...anchor, ...settings.current }
    if (samePosition(next, position.current)) return
    position.current = next
    clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(savePosition, 200)
  }, [savePosition])

  useLayoutEffect(() => {
    const previous = settings.current
    settings.current = { zoom, readingMode }
    if (previous.zoom !== zoom || previous.readingMode !== readingMode) {
      moveTo(navigation.current?.getPosition() ?? position.current)
    }
  }, [moveTo, readingMode, zoom])

  useLayoutEffect(() => {
    const flush = () => {
      const anchor = navigation.current?.getPosition()
      if (anchor) moveTo(anchor)
      savePosition()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [moveTo, savePosition])

  useEffect(() => {
    let active = true
    searchRun.current++
    setPdf(undefined)
    setError('')
    setSearching(false)
    setMatches([])
    setSearchStatus('')
    let recovering = false
    const task = openPdf(url ? { url, httpHeaders: JSON.parse(headerKey), byteLength } : { data: data!.slice(0) },
      streamFallback ? undefined : cause => {
        if (!active) return
        if (pdfAccessDenied(cause)) {
          setPdf(undefined)
          setError(pdfErrorMessage(cause))
        } else {
          recovering = true
          setStreamFallback(true)
        }
      })
    void task.promise.then(document => {
      if (!active) return
      setPdf(document)
      const current = Math.max(1, Math.min(document.numPages, activePage.current))
      activePage.current = current
      setPage(current)
    }, cause => { if (active && !recovering) setError(pdfErrorMessage(cause)) })
    return () => {
      active = false
      searchRun.current++
      void task.destroy().catch(() => {})
    }
  }, [url, data, byteLength, headerKey, attempt, streamFallback])

  useEffect(() => {
    setPageInput(String(page))
  }, [page])

  useLayoutEffect(() => {
    if (showSearch) searchField.current?.focus({ preventScroll: true })
  }, [showSearch])

  useLayoutEffect(() => {
    const host = scroll.current!
    const maxWidth = readingMode ? 1500 : 1000
    const update = () => {
      const style = getComputedStyle(host)
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      setWidth(Math.max(1, Math.min(maxWidth, host.clientWidth - padding)))
    }
    update()
    const resize = new ResizeObserver(update)
    resize.observe(host)
    return () => resize.disconnect()
  }, [readingMode])

  useLayoutEffect(() => {
    if (!readingMode) {
      if (restoreModeFocus.current) {
        restoreModeFocus.current = false
        modeToggle.current?.focus({ preventScroll: true })
      }
      return
    }
    if (!reader.current) return
    restoreModeFocus.current = true
    const surface = reader.current
    const toggle = modeToggle.current
    const inactive: HTMLElement[] = []
    // Keep the page state and captured selection in the same reader.
    for (let branch: HTMLElement | null = surface; branch && branch !== document.body; branch = branch.parentElement) {
      for (const sibling of branch.parentElement?.children ?? []) {
        if (sibling !== branch && sibling instanceof HTMLElement && !sibling.inert) {
          sibling.inert = true
          inactive.push(sibling)
        }
      }
    }
    document.documentElement.classList.add('pdf-reading-active')
    toggle?.focus({ preventScroll: true })

    return () => {
      for (const element of inactive) element.inert = false
      document.documentElement.classList.remove('pdf-reading-active')
    }
  }, [readingMode])

  function toggleReadingMode() {
    if (!readingMode) {
      setShowSearch(false)
      setShowNotes(false)
      setHighlightHelp(false)
    }
    setReadingMode(!readingMode)
  }

  const changePage = useCallback((number: number) => {
    if (activePage.current === number) return
    activePage.current = number
    setPage(number)
  }, [])

  function jump(number: number) {
    if (!pdf || !Number.isFinite(number)) {
      setPageInput(String(page))
      return
    }
    const target = Math.max(1, Math.min(pdf.numPages, Math.trunc(number)))
    setPageInput(String(target))
    setSelection(undefined)
    window.getSelection()?.removeAllRanges()
    navigation.current?.jump(target)
    changePage(target)
  }

  function applyChange(change: AnnotationChange, forward: boolean) {
    for (const annotation of change.annotations) {
      if (change.added === forward) onAnnotationAdd(annotation)
      else onAnnotationRemove(annotation.id)
    }
  }

  function recordChange(change: AnnotationChange, feedback: string) {
    applyChange(change, true)
    setHistory(previous => ({ undo: [...previous.undo, change], redo: [] }))
    setEditFeedback(feedback)
  }

  function replay(redo: boolean) {
    const change = (redo ? history.redo : history.undo).at(-1)
    if (!change) return
    const shouldExist = change.added !== redo
    if (change.annotations.some(changed => annotations.some(annotation => annotation.id === changed.id) !== shouldExist)) {
      const stack = redo ? 'redo' : 'undo'
      setHistory({ ...history, [stack]: history[stack].slice(0, -1) })
      setEditFeedback('La marca ya cambió en otra sesión')
      return
    }
    applyChange(change, redo)
    setHistory(redo
      ? { undo: [...history.undo, change], redo: history.redo.slice(0, -1) }
      : { undo: history.undo.slice(0, -1), redo: [...history.redo, change] })
    setEditFeedback(redo ? 'Cambio rehecho' : 'Cambio deshecho')
    scroll.current?.focus({ preventScroll: true })
  }

  function handleReaderKeys(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.repeat) return
    if (event.key === 'Escape' && (showSearch || showNotes || readingMode)) {
      event.preventDefault()
      if (showSearch) {
        setShowSearch(false)
        searchToggle.current?.focus({ preventScroll: true })
      } else if (showNotes) {
        setShowNotes(false)
        notesToggle.current?.focus({ preventScroll: true })
      } else {
        setReadingMode(false)
      }
      return
    }
    if (readingMode && event.key === 'Tab') {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      )).filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault()
        const next = event.shiftKey ? last : first
        next?.focus()
      }
      return
    }
    if (event.altKey || (!event.ctrlKey && !event.metaKey)) return
    const key = event.key.toLowerCase()
    if (key === 'f' && !event.shiftKey && pdf) {
      event.preventDefault()
      setShowSearch(true)
      setShowNotes(false)
      searchField.current?.focus({ preventScroll: true })
      return
    }
    const target = event.target
    if (target instanceof HTMLElement && (target.closest('input, textarea, select') || target.isContentEditable)) return
    if (window.getSelection()?.isCollapsed === false) return
    const redo = (key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.shiftKey)
    if (key !== 'z' && !redo) return
    if (!(redo ? history.redo : history.undo).length) return
    event.preventDefault()
    replay(redo)
  }

  function tapHighlight(event: MouseEvent<HTMLDivElement>) {
    const start = pointerStart.current
    pointerStart.current = null
    if (event.detail !== 1 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
    if (!(event.target instanceof Element) || event.target.closest('button, a')) return
    if (start && (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8
      || (start.type === 'touch' && performance.now() - start.at > 500))) return
    const hit = (rect: DOMRect) => event.clientX >= rect.left && event.clientX < rect.right
      && event.clientY >= rect.top && event.clientY < rect.bottom
    const nativeSelection = window.getSelection()
    if (nativeSelection?.isCollapsed === false) {
      if (Array.from(nativeSelection.getRangeAt(0).getClientRects()).some(hit)) return
      nativeSelection.removeAllRanges()
    }
    setSelection(undefined)
    const sheet = event.target.closest('.pdf-sheet')
    const marks = Array.from(sheet?.querySelectorAll<HTMLElement>('[data-highlight-id]') ?? [])
    const ids = new Set(marks.filter(mark => hit(mark.getBoundingClientRect())).map(mark => mark.dataset.highlightId))
    const removed = annotations.filter(annotation => ids.has(annotation.id))
    if (!removed.length) {
      setEditFeedback('')
      return
    }
    recordChange({ annotations: removed, added: false }, 'Subrayado quitado')
    setHighlightHelp(false)
    scroll.current?.focus({ preventScroll: true })
  }

  function add(kind: PdfAnnotation['kind'], target = page, text?: string, rects?: PdfAnnotation['rects']) {
    const annotation = { id: crypto.randomUUID(), page: target, kind, text, rects, createdAt: new Date().toISOString() }
    recordChange({ annotations: [annotation], added: true }, kind === 'note' ? 'Nota guardada' : kind === 'bookmark' ? 'Marcador guardado' : 'Subrayado añadido')
  }

  function remove(annotation: PdfAnnotation) {
    if (annotation.kind !== 'highlight' && !window.confirm(`¿Eliminar ${annotation.kind === 'note' ? 'esta nota' : 'este marcador'}?`)) return
    recordChange({ annotations: [annotation], added: false }, annotation.kind === 'note' ? 'Nota eliminada'
      : annotation.kind === 'bookmark' ? 'Marcador eliminado' : 'Subrayado quitado')
    scroll.current?.focus({ preventScroll: true })
  }

  function addHighlight() {
    if (!selection) {
      setHighlightHelp(value => !value)
      return
    }
    const existing = annotations.flatMap(annotation => annotation.kind === 'highlight' && annotation.page === selection.page
      ? annotation.rects ?? [] : [])
    const rects = uncoveredHighlightRects(selection.rects, existing)
    if (rects.length) add('highlight', selection.page, selection.text, rects)
    else setEditFeedback('El texto ya está subrayado')
    setHighlightHelp(false)
    window.getSelection()?.removeAllRanges()
    setSelection(undefined)
    scroll.current?.focus({ preventScroll: true })
  }

  async function downloadOriginal() {
    if (downloading) return
    setDownloading(true)
    setDownloadError('')
    try {
      await onDownload()
    } catch (failure) {
      setDownloadError(failure instanceof Error ? failure.message : 'No se pudo descargar el original.')
    } finally {
      setDownloading(false)
    }
  }

  async function find(event: FormEvent) {
    event.preventDefault()
    if (!pdf || !query.trim()) return
    const terms = queryWords(query)
    if (!terms.length) {
      setSearchStatus('Escribe alguna palabra o número para buscar.')
      return
    }
    const run = ++searchRun.current
    setActiveQuery(query)
    setSearching(true)
    setMatches([])
    setSearchStatus('Buscando en el PDF…')
    const results: LocalMatch[] = []
    let published = 0
    let textPages = 0
    let failedPages = 0
    try {
      for (let current = 1; current <= pdf.numPages; current++) {
        if (run !== searchRun.current) return
        try {
          const item = await pdf.getPage(current)
          const content = await item.getTextContent()
          if (run !== searchRun.current) return
          const text = textRuns(content.items.filter(isTextItem)).text.replace(/\s+/gu, ' ').trim()
          const words = (text.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).map(foldWord)
          if (words.length) textPages++
          if (terms.every(term => words.some(word => term.length >= 3 ? word.startsWith(term) : word === term))) {
            results.push({ page: current, text: contextualSnippet(text, terms) })
          }
        } catch {
          failedPages++
        }
        if (run === searchRun.current && (current % 10 === 0 || (results.length > 0 && !published))) {
          if (results.length > published) {
            setMatches([...results])
            published = results.length
          }
          setSearchStatus(`Buscando… ${current} de ${pdf.numPages} páginas`)
        }
      }
    } finally {
      if (run === searchRun.current) {
        setSearching(false)
        setMatches(results)
        const label = results.length === 1 ? '1 página con coincidencias'
          : results.length ? `${results.length} páginas con coincidencias`
          : textPages ? 'Sin coincidencias' : failedPages ? 'No se ha podido comprobar el texto' : 'El PDF no tiene texto extraíble'
        setSearchStatus(failedPages ? `${label}. ${failedPages} páginas sin comprobar.` : label)
      }
    }
  }

  const currentBookmark = annotations.find(annotation => annotation.kind === 'bookmark' && annotation.page === page)
  const sortedAnnotations = [...annotations].sort((first, second) => first.page - second.page)

  return <section ref={reader} className={readingMode ? 'pdf-reader pdf-reader--focus' : 'pdf-reader'}
    role={readingMode ? 'dialog' : undefined} aria-modal={readingMode || undefined}
    aria-label={readingMode ? 'Modo lectura PDF' : 'Lector PDF'} onKeyDown={handleReaderKeys}>
    <div className="pdf-toolbar">
      <div className="pdf-tools pdf-tools-pages" role="group" aria-label="Navegación de páginas">
        <button type="button" aria-label="Página anterior" disabled={!pdf || page <= 1} onClick={() => jump(page - 1)}><ChevronLeft /></button>
        <form className="pdf-page-form" onSubmit={event => {
          event.preventDefault()
          jump(pageInput ? Number(pageInput) : page)
          scroll.current?.focus({ preventScroll: true })
        }}>
          <input aria-label="Número de página" inputMode="numeric" pattern="[0-9]*" value={pageInput} disabled={!pdf}
            onChange={event => setPageInput(event.target.value)} onKeyDown={event => {
              if (event.key === 'Escape' && pageInput !== String(page)) {
                event.preventDefault()
                setPageInput(String(page))
              }
            }} />
          <span aria-label={pdf ? `de ${pdf.numPages} páginas` : 'Número de páginas desconocido'}>/ {pdf?.numPages ?? '–'}</span>
          <button type="submit" aria-label="Ir a la página" disabled={!pdf || pageInput === String(page) || !pageInput}>
            <CornerDownLeft />
          </button>
        </form>
        <button type="button" aria-label="Página siguiente" disabled={!pdf || page >= pdf.numPages} onClick={() => jump(page + 1)}><ChevronRight /></button>
      </div>
      <div className="pdf-tools" role="group" aria-label="Zoom">
        <button type="button" aria-label="Reducir zoom" disabled={!pdf || zoom <= 0.75}
          onClick={() => setZoom(value => Math.max(0.75, value - 0.25))}><Minus /></button>
        <button type="button" className="pdf-zoom" aria-label="Ajustar al ancho" disabled={!pdf} onClick={() => setZoom(1)}>{Math.round(zoom * 100)} %</button>
        <button type="button" aria-label="Aumentar zoom" disabled={!pdf || zoom >= 3}
          onClick={() => setZoom(value => Math.min(3, value + 0.25))}><Plus /></button>
      </div>
      <div className="pdf-tools pdf-tools-actions" role="group" aria-label="Herramientas">
        <button type="button" ref={searchToggle} aria-label="Buscar en este PDF" aria-expanded={showSearch} disabled={!pdf}
          onClick={() => { setShowSearch(value => !value); setShowNotes(false) }}><Search /></button>
        <button type="button" aria-label={currentBookmark ? 'Quitar marcador' : 'Marcar página'} aria-pressed={Boolean(currentBookmark)}
          disabled={!pdf} onClick={() => currentBookmark
            ? remove(currentBookmark)
            : add('bookmark')}><Bookmark /></button>
        <button type="button" className="pdf-highlight-button" aria-label="Subrayar texto seleccionado"
          title="Selecciona texto para subrayar. Toca un subrayado para quitarlo." aria-expanded={selection ? undefined : highlightHelp}
          data-selected={!!selection} disabled={!pdf}
          onMouseDown={event => event.preventDefault()} onClick={addHighlight}><Highlighter /> <span>Subrayar</span></button>
        <button type="button" ref={notesToggle} aria-label="Notas, marcadores y subrayados" aria-expanded={showNotes} disabled={!pdf}
          onClick={() => { setShowNotes(value => !value); setShowSearch(false) }}><StickyNote /></button>
        <button type="button" ref={downloadButton} aria-label="Descargar original" aria-disabled={downloading}
          onClick={() => void downloadOriginal()}><Download /></button>
        {originalUrl && <a href={originalUrl} target="_blank" rel="noopener noreferrer" aria-label="Abrir PDF en Drive"><ExternalLink /></a>}
      </div>
      <button type="button" className="pdf-mode-toggle" ref={modeToggle} onClick={toggleReadingMode}
        aria-label={readingMode ? 'Salir del modo lectura' : 'Modo lectura'} aria-haspopup={readingMode ? undefined : 'dialog'}>
        {readingMode ? <X /> : <Maximize2 />}
        <span className="pdf-mode-label">{readingMode ? 'Salir' : 'Modo lectura'}</span>
        {!readingMode && <span className="pdf-mode-short">Leer</span>}
      </button>
    </div>

    {downloading && <p className="pdf-download-feedback" role="status">Preparando descarga…</p>}
    {downloadError && <div className="pdf-download-feedback pdf-download-error">
      <p role="alert">{downloadError}</p>
      <button type="button" aria-label="Cerrar aviso de descarga" onClick={() => {
        setDownloadError('')
        downloadButton.current?.focus({ preventScroll: true })
      }}><X size={17} /></button>
    </div>}

    {highlightHelp && !selection && <p className="pdf-highlight-help" role="status">
      Selecciona el texto del PDF y pulsa Subrayar. En iPhone, mantén pulsada una palabra. Toca una marca guardada para quitarla.
    </p>}

    {showSearch && <div className="pdf-panel">
      <form onSubmit={event => void find(event)} className="pdf-panel-form">
        <input ref={searchField} type="search" aria-label="Texto para buscar dentro del PDF" placeholder="Buscar en el documento"
          value={query} onChange={event => {
            setQuery(event.target.value)
            searchRun.current++
            setSearching(false)
            setActiveQuery('')
            setMatches([])
            setSearchStatus('')
          }} />
        <button type="submit" disabled={!pdf || !query.trim() || searching}>Buscar</button>
      </form>
      {searchStatus && <p className="pdf-feedback" role="status">{searchStatus}</p>}
      {!!matches.length && <ul className="pdf-panel-list">
        {matches.map(match => <li key={match.page}><button type="button" onClick={() => {
          jump(match.page)
          setShowSearch(false)
          scroll.current?.focus({ preventScroll: true })
        }}>
          <strong>Pág. {match.page}</strong> {match.text}
        </button></li>)}
      </ul>}
    </div>}

    {showNotes && <div className="pdf-panel">
      {(history.undo.length > 0 || history.redo.length > 0) && <div className="pdf-annotation-history">
        <button type="button" disabled={!history.undo.length} onClick={() => replay(false)}>Deshacer última marca</button>
        <button type="button" disabled={!history.redo.length} onClick={() => replay(true)}>Rehacer última marca</button>
      </div>}
      <form className="pdf-panel-form" onSubmit={event => {
        event.preventDefault()
        if (!draft.trim()) return
        add('note', draftPage ?? page, draft.trim())
        setDraft('')
        setDraftPage(undefined)
      }}>
        <textarea aria-label={`Nota de la página ${draftPage ?? page}`} placeholder={`Añadir nota a la página ${draftPage ?? page}`}
          maxLength={4000} value={draft} onChange={event => {
            setDraft(event.target.value)
            setDraftPage(event.target.value ? draftPage ?? page : undefined)
          }} />
        <button type="submit" disabled={!draft.trim()}>Guardar nota</button>
      </form>
      {!sortedAnnotations.length && <p className="pdf-feedback">Tus notas, marcadores y subrayados aparecerán aquí.</p>}
      {!!sortedAnnotations.length && <ul className="pdf-panel-list">
        {sortedAnnotations.map(annotation => <li key={annotation.id} className="pdf-annotation-row">
          <button type="button" onClick={() => {
            jump(annotation.page)
            setShowNotes(false)
            scroll.current?.focus({ preventScroll: true })
          }}>
            <strong>Pág. {annotation.page}</strong> {annotation.text || 'Marcador'}
          </button>
          <button type="button" className="pdf-remove" aria-label={`Eliminar ${annotationNames[annotation.kind]} de la página ${annotation.page}`}
            onClick={() => remove(annotation)}><Trash2 /></button>
        </li>)}
      </ul>}
    </div>}

    <div className="pdf-scroll" ref={scroll} role="region" aria-label="Página del PDF" tabIndex={0} onClick={tapHighlight}
      onPointerDown={event => {
        pointerStart.current = { x: event.clientX, y: event.clientY, type: event.pointerType, at: performance.now() }
      }}>
      {error && <div className="pdf-reader-state" role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => {
          setStreamFallback(false)
          setAttempt(value => value + 1)
        }}>Reintentar</button>
        {onReconnect && <button type="button" onClick={onReconnect}>Reconectar Drive</button>}
      </div>}
      {!error && !pdf && <p className="pdf-reader-state" role="status">Abriendo PDF…</p>}
      {pdf && width > 0 && <PdfPages pdf={pdf} initialPosition={position.current} width={width} zoom={zoom}
        query={activeQuery} annotations={annotations} selectedPage={selection?.page} hostRef={scroll} navigationRef={navigation}
        onPageChange={changePage} onPositionChange={moveTo} onSelection={setSelection} />}
    </div>
    {editFeedback && <div className="pdf-annotation-feedback">
      <span role="status">{editFeedback}</span>
      {history.undo.length > 0 && <button type="button" onClick={() => replay(false)}>Deshacer</button>}
      {history.redo.length > 0 && <button type="button" onClick={() => replay(true)}>Rehacer</button>}
      <button type="button" aria-label="Cerrar acciones de marcas" onClick={() => {
        setEditFeedback('')
        scroll.current?.focus({ preventScroll: true })
      }}><X size={17} /></button>
    </div>}
  </section>
}

function samePosition(first: PdfReadingPosition, second: PdfReadingPosition) {
  return first.page === second.page && Math.abs((first.offset ?? 0) - (second.offset ?? 0)) < 0.001
    && Math.abs((first.horizontal ?? 0) - (second.horizontal ?? 0)) < 0.001
    && (first.zoom ?? 1) === (second.zoom ?? 1)
    && !!first.readingMode === !!second.readingMode
}
