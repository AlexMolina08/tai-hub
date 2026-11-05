import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Bookmark, ChevronLeft, ChevronRight, CornerDownLeft, Download, ExternalLink, Highlighter, Maximize2, Minus, Plus, Search, StickyNote, Trash2, X } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import { openPdf, pdfErrorMessage } from '../pdf/document'
import { pdfAccessDenied } from '../pdf/range'
import type { PdfAnnotation, PdfSource } from '../pdf/model'
import { PdfPages } from '../pdf/PdfPages'
import type { PdfPageNavigation } from '../pdf/PdfPages'
import type { PdfSelection } from '../pdf/PageCanvas'
import { contextualSnippet, foldWord, isTextItem, queryWords, textRuns } from '../pdf/text'
import './pdf-reader.css'

export type { PdfAnnotation, PdfSource } from '../pdf/model'

export interface PdfReaderProps {
  source: PdfSource
  initialPage?: number
  initialQuery?: string
  annotations: PdfAnnotation[]
  onPageChange: (page: number) => void
  onAnnotationAdd: (annotation: PdfAnnotation) => void
  onAnnotationRemove: (id: string) => void
  onDownload: () => void
  onReconnect?: () => void
  originalUrl?: string
}

interface LocalMatch {
  page: number
  text: string
}

export default function PdfReader({
  source, initialPage = 1, initialQuery = '', annotations, onPageChange,
  onAnnotationAdd, onAnnotationRemove, onDownload, onReconnect, originalUrl,
}: PdfReaderProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [streamFallback, setStreamFallback] = useState(false)
  const [page, setPage] = useState(initialPage)
  const [pageInput, setPageInput] = useState(String(initialPage))
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)
  const [selection, setSelection] = useState<PdfSelection>()
  const [readingMode, setReadingMode] = useState(false)
  const [highlightHelp, setHighlightHelp] = useState(false)
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
  const restoreModeFocus = useRef(false)
  const scroll = useRef<HTMLDivElement>(null)
  const navigation = useRef<PdfPageNavigation>(null)
  const activePage = useRef(initialPage)
  const reportPage = useRef(onPageChange)
  useLayoutEffect(() => { reportPage.current = onPageChange }, [onPageChange])
  const url = source.url
  const data = source.data
  const byteLength = source.byteLength
  const headerKey = JSON.stringify(source.httpHeaders ?? {})

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

    function handleKeys(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        setReadingMode(false)
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(surface.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      )).filter(element => element.getClientRects().length)
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault()
        const next = event.shiftKey ? last : first
        next?.focus()
      }
    }

    document.addEventListener('keydown', handleKeys)
    return () => {
      document.removeEventListener('keydown', handleKeys)
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
    reportPage.current(number)
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

  function add(kind: PdfAnnotation['kind'], target = page, text?: string, rects?: PdfAnnotation['rects']) {
    onAnnotationAdd({ id: crypto.randomUUID(), page: target, kind, text, rects, createdAt: new Date().toISOString() })
  }

  function addHighlight() {
    if (!selection) {
      setHighlightHelp(value => !value)
      return
    }
    add('highlight', selection.page, selection.text, selection.rects)
    setHighlightHelp(false)
    window.getSelection()?.removeAllRanges()
    setSelection(undefined)
  }

  async function find(event: FormEvent) {
    event.preventDefault()
    if (!pdf || !query.trim()) return
    const terms = queryWords(query)
    if (!terms.length) return
    const run = ++searchRun.current
    setActiveQuery(query)
    setSearching(true)
    setMatches([])
    setSearchStatus('Buscando en el PDF…')
    const results: LocalMatch[] = []
    let textPages = 0
    let failedPages = 0
    try {
      for (let current = 1; current <= pdf.numPages; current++) {
        if (run !== searchRun.current) return
        try {
          const item = await pdf.getPage(current)
          const content = await item.getTextContent()
          const text = textRuns(content.items.filter(isTextItem)).text.replace(/\s+/gu, ' ').trim()
          const words = (text.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).map(foldWord)
          if (words.length) textPages++
          if (terms.every(term => words.some(word => term.length >= 3 ? word.startsWith(term) : word === term))) {
            results.push({ page: current, text: contextualSnippet(text, terms) })
          }
        } catch {
          failedPages++
        }
        if (current % 15 === 0 && run === searchRun.current) {
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
    aria-label={readingMode ? 'Modo lectura PDF' : 'Lector PDF'}>
    <div className="pdf-toolbar">
      <div className="pdf-tools" role="group" aria-label="Navegación de páginas">
        <button type="button" aria-label="Página anterior" disabled={!pdf || page <= 1} onClick={() => jump(page - 1)}><ChevronLeft /></button>
        <form className="pdf-page-form" onSubmit={event => { event.preventDefault(); jump(pageInput ? Number(pageInput) : page) }}>
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
        <button type="button" aria-label="Buscar en este PDF" aria-expanded={showSearch} disabled={!pdf}
          onClick={() => { setShowSearch(value => !value); setShowNotes(false) }}><Search /></button>
        <button type="button" aria-label={currentBookmark ? 'Quitar marcador' : 'Marcar página'} aria-pressed={Boolean(currentBookmark)}
          disabled={!pdf} onClick={() => currentBookmark
            ? window.confirm('¿Quitar el marcador de esta página?') && onAnnotationRemove(currentBookmark.id)
            : add('bookmark')}><Bookmark /></button>
        <button type="button" className="pdf-highlight-button" aria-label="Subrayar texto seleccionado"
          title="Selecciona texto para subrayarlo" aria-expanded={selection ? undefined : highlightHelp}
          data-selected={!!selection} disabled={!pdf}
          onMouseDown={event => event.preventDefault()} onClick={addHighlight}><Highlighter /> <span>Subrayar</span></button>
        <button type="button" aria-label="Notas, marcadores y subrayados" aria-expanded={showNotes} disabled={!pdf}
          onClick={() => { setShowNotes(value => !value); setShowSearch(false) }}><StickyNote /></button>
        <button type="button" aria-label="Descargar original" onClick={onDownload}><Download /></button>
        {originalUrl && <a href={originalUrl} target="_blank" rel="noopener noreferrer" aria-label="Abrir PDF en Drive"><ExternalLink /></a>}
      </div>
      <button type="button" className="pdf-mode-toggle" ref={modeToggle} onClick={toggleReadingMode}
        aria-label={readingMode ? 'Salir del modo lectura' : 'Modo lectura'} aria-haspopup={readingMode ? undefined : 'dialog'}>
        {readingMode ? <X /> : <Maximize2 />}
        <span className="pdf-mode-label">{readingMode ? 'Salir' : 'Modo lectura'}</span>
        {!readingMode && <span className="pdf-mode-short">Leer</span>}
      </button>
    </div>

    {highlightHelp && !selection && <p className="pdf-highlight-help" role="status">
      Selecciona el texto del PDF y pulsa Subrayar. En iPhone, mantén pulsada una palabra y ajusta la selección.
    </p>}

    {showSearch && <div className="pdf-panel">
      <form onSubmit={event => void find(event)} className="pdf-panel-form">
        <input type="search" aria-label="Texto para buscar dentro del PDF" placeholder="Buscar en el documento"
          value={query} onChange={event => {
            setQuery(event.target.value)
            if (!event.target.value) {
              searchRun.current++
              setSearching(false)
              setActiveQuery('')
              setMatches([])
              setSearchStatus('')
            }
          }} />
        <button type="submit" disabled={!pdf || !query.trim() || searching}>Buscar</button>
      </form>
      {searchStatus && <p className="pdf-feedback" role="status">{searchStatus}</p>}
      {!!matches.length && <ul className="pdf-panel-list">
        {matches.map(match => <li key={match.page}><button type="button" onClick={() => jump(match.page)}>
          <strong>Pág. {match.page}</strong> {match.text}
        </button></li>)}
      </ul>}
    </div>}

    {showNotes && <div className="pdf-panel">
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
          <button type="button" onClick={() => jump(annotation.page)}>
            <strong>Pág. {annotation.page}</strong> {annotation.text || 'Marcador'}
          </button>
          <button type="button" className="pdf-remove" aria-label={`Eliminar ${annotation.kind === 'bookmark' ? 'marcador' :
            annotation.kind === 'note' ? 'nota' : 'subrayado'} de la página ${annotation.page}`} onClick={() => {
              if (window.confirm('¿Eliminar esta marca del PDF?')) onAnnotationRemove(annotation.id)
            }}><Trash2 /></button>
        </li>)}
      </ul>}
    </div>}

    <div className="pdf-scroll" ref={scroll} role="region" aria-label="Página del PDF" tabIndex={0}>
      {error && <div className="pdf-reader-state" role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => {
          setStreamFallback(false)
          setAttempt(value => value + 1)
        }}>Reintentar</button>
        {onReconnect && <button type="button" onClick={onReconnect}>Reconectar Drive</button>}
      </div>}
      {!error && !pdf && <p className="pdf-reader-state" role="status">Abriendo PDF…</p>}
      {pdf && width > 0 && <PdfPages pdf={pdf} initialPage={page} width={width} zoom={zoom}
        query={activeQuery} annotations={annotations} selectedPage={selection?.page} hostRef={scroll} navigationRef={navigation}
        onPageChange={changePage} onSelection={setSelection} />}
    </div>
  </section>
}
