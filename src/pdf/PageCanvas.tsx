import { memo, useEffect, useRef, useState } from 'react'
import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/types/src/display/api'
import type { PdfAnnotation, PdfRect } from './model'
import { isTextItem, matchRanges, queryWords, textRuns } from './text'

export interface PdfSelection {
  page: number
  text: string
  rects: PdfRect[]
}

interface Props {
  pdf: PDFDocumentProxy
  page: number
  width: number
  zoom: number
  query: string
  annotations: PdfAnnotation[]
  onSelection: (selection: PdfSelection) => void
  onMeasure: (page: number, ratio: number) => void
  onPaint: () => void
}

export const PageCanvas = memo(function PageCanvas({ pdf, page, width, zoom, query, annotations, onSelection, onMeasure, onPaint }: Props) {
  const surface = useRef<HTMLDivElement>(null)
  const canvasHost = useRef<HTMLDivElement>(null)
  const textHost = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [textLayer, setTextLayer] = useState<{ layer: TextLayer; text: ReturnType<typeof textRuns> }>()
  const [matches, setMatches] = useState<PdfRect[]>([])

  useEffect(() => {
    const sheet = surface.current!
    const canvasContainer = canvasHost.current!
    const textContainer = textHost.current!
    let active = true
    let render: RenderTask | undefined
    let pageProxy: PDFPageProxy | undefined
    let layer: TextLayer | undefined
    const canvas = document.createElement('canvas')
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', `Página ${page} del PDF`)
    setStatus('loading')
    setTextLayer(undefined)
    setMatches([])

    async function draw() {
      pageProxy = await pdf.getPage(page)
      if (!active) {
        pageProxy.cleanup()
        return
      }
      const base = pageProxy.getViewport({ scale: 1 })
      onMeasure(page, base.height / base.width)
      const viewport = pageProxy.getViewport({ scale: width * zoom / base.width })
      const { width: pageWidth, height: pageHeight } = viewport
      const pixelLimit = width <= 650 ? 4_000_000 : 8_000_000
      const ratio = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(pageWidth, pageHeight),
        Math.sqrt(pixelLimit / (pageWidth * pageHeight)))
      sheet.style.width = `${pageWidth}px`
      sheet.style.height = `${pageHeight}px`
      sheet.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit))
      canvas.width = Math.max(1, Math.floor(pageWidth * ratio))
      canvas.height = Math.max(1, Math.floor(pageHeight * ratio))
      canvasContainer.replaceChildren(canvas)
      render = pageProxy.render({
        canvas,
        viewport,
        transform: [canvas.width / pageWidth, 0, 0, canvas.height / pageHeight, 0, 0],
      })
      await render.promise
      if (!active) return
      setStatus('ready')
      onPaint()
      try {
        const content = await pageProxy.getTextContent()
        if (!active) return
        layer = new TextLayer({ textContentSource: content, container: textContainer, viewport })
        await layer.render()
        if (active) setTextLayer({ layer, text: textRuns(content.items.filter(isTextItem)) })
      } catch {
        // A page can render even when PDF.js cannot construct a selectable text layer.
      }
    }

    void draw().catch(() => {
      if (active) {
        setStatus('error')
        onPaint()
      }
    })
    return () => {
      active = false
      layer?.cancel()
      render?.cancel()
      canvas.remove()
      const release = () => {
        canvas.width = canvas.height = 0
        pageProxy?.cleanup()
      }
      void (render?.promise ?? Promise.resolve()).then(release, release)
      textContainer.replaceChildren()
    }
  }, [pdf, page, width, zoom, onMeasure, onPaint])

  useEffect(() => {
    const layerState = textLayer
    const sheet = surface.current
    if (!layerState || !sheet || !query.trim()) {
      setMatches([])
      return
    }
    const rects: PdfRect[] = []
    const { text, runs } = layerState.text
    const terms = queryWords(query)
    const ranges = matchRanges(text, terms).slice(0, 300)
    const bounds = sheet.getBoundingClientRect()
    let runIndex = 0
    for (const range of ranges) {
      while (runIndex < runs.length && runs[runIndex].end <= range.start) runIndex++
      for (let i = runIndex; i < runs.length && runs[i].start < range.end; i++) {
        const div = layerState.layer.textDivs[i]
        const node = div?.firstChild
        if (node?.nodeType !== Node.TEXT_NODE || !div.isConnected) continue
        const start = Math.max(0, range.start - runs[i].start)
        const end = Math.min(node.textContent?.length ?? 0, range.end - runs[i].start)
        if (end <= start) continue
        const domRange = document.createRange()
        domRange.setStart(node, start)
        domRange.setEnd(node, end)
        rects.push(...normalizeRects(domRange.getClientRects(), bounds))
      }
    }
    setMatches(rects)
  }, [textLayer, query])

  useEffect(() => {
    function selectionChanged() {
      const selection = window.getSelection()
      const sheet = surface.current
      const layer = textHost.current
      if (!selection || !selection.rangeCount || selection.isCollapsed || !sheet || !layer) return
      const range = selection.getRangeAt(0)
      if (!layer.contains(range.startContainer) || !layer.contains(range.endContainer)) return
      const text = selection.toString().trim()
      const rects = normalizeRects(range.getClientRects(), sheet.getBoundingClientRect())
      if (text && rects.length) onSelection({ page, text: text.slice(0, 2000), rects: rects.slice(0, 200) })
    }
    document.addEventListener('selectionchange', selectionChanged)
    return () => document.removeEventListener('selectionchange', selectionChanged)
  }, [onSelection, page])

  return <div className="pdf-sheet" ref={surface} aria-busy={status === 'loading'}>
    <div className="pdf-canvas" ref={canvasHost} />
    <div className="pdf-highlights" aria-hidden="true">
      {annotations.flatMap(annotation => (annotation.rects ?? []).map((rect, index) =>
        <Overlay key={`${annotation.id}-${index}`} rect={rect} />))}
      {matches.map((rect, index) => <Overlay key={index} rect={rect} match />)}
    </div>
    <div className="textLayer" ref={textHost} />
    {status === 'loading' && <p className="pdf-sheet-status" role="status">Cargando página…</p>}
    {status === 'error' && <p className="pdf-sheet-status" role="status">Esta página no se ha podido renderizar.</p>}
  </div>
})

function Overlay({ rect, match }: { rect: PdfRect; match?: boolean }) {
  return <span className={match ? 'pdf-search-mark' : 'pdf-user-mark'} style={{
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  }} />
}

function normalizeRects(rects: Iterable<DOMRect>, page: DOMRect): PdfRect[] {
  return Array.from(rects).flatMap(rect => {
    const left = Math.max(page.left, rect.left)
    const top = Math.max(page.top, rect.top)
    const right = Math.min(page.right, rect.right)
    const bottom = Math.min(page.bottom, rect.bottom)
    if (right - left < 1 || bottom - top < 1) return []
    return [{ x: (left - page.left) / page.width, y: (top - page.top) / page.height,
      width: (right - left) / page.width, height: (bottom - top) / page.height }]
  })
}
