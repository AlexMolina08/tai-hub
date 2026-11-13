import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import { PageCanvas, readPdfSelection } from './PageCanvas'
import type { PdfSelection } from './PageCanvas'
import type { PdfAnnotation, PdfReadingPosition } from './model'

const pageGap = 12
const noMarks: PdfAnnotation[] = []

interface Layout {
  width: number
  offsets: number[]
  heights: number[]
  end: number
}

interface Viewport {
  left: number
  top: number
  height: number
}

export interface PdfPageNavigation {
  jump(page: number): void
  getPosition(): PdfReadingPosition | undefined
}

interface Props {
  pdf: PDFDocumentProxy
  initialPosition: PdfReadingPosition
  width: number
  zoom: number
  query: string
  annotations: PdfAnnotation[]
  selectedPage?: number
  hostRef: RefObject<HTMLDivElement | null>
  navigationRef: RefObject<PdfPageNavigation | null>
  onPageChange: (page: number) => void
  onPositionChange: (position: PdfReadingPosition) => void
  onSelection: (selection?: PdfSelection) => void
}

export function PdfPages({
  pdf, initialPosition, width, zoom, query, annotations, selectedPage, hostRef, navigationRef, onPageChange,
  onPositionChange, onSelection,
}: Props) {
  const startPosition = useRef(initialPosition)
  const startingIndex = useRef(Math.max(0, Math.min(pdf.numPages - 1, initialPosition.page - 1)))
  const [measurements, setMeasurements] = useState<{ fallback: number; ratios: Map<number, number> }>(
    () => ({ fallback: Math.SQRT2, ratios: new Map() }),
  )
  const [viewport, setViewport] = useState<Viewport>(() => ({
    left: 0, top: 0, height: hostRef.current?.clientHeight ?? 0,
  }))
  const [painted, setPainted] = useState(false)
  const committedLayout = useRef<Layout | undefined>(undefined)
  const lastViewport = useRef(viewport)
  const pageWidth = width * zoom
  const layout = useMemo(() => {
    const offsets: number[] = []
    const heights: number[] = []
    let end = 0
    for (let page = 1; page <= pdf.numPages; page++) {
      const height = pageWidth * (measurements.ratios.get(page) ?? measurements.fallback)
      offsets.push(end)
      heights.push(height)
      end += height + pageGap
    }
    return { width: pageWidth, offsets, heights, end }
  }, [measurements, pageWidth, pdf.numPages])

  const marksByPage = useMemo(() => {
    const marks = new Map<number, PdfAnnotation[]>()
    for (const annotation of annotations) {
      if (annotation.kind !== 'highlight') continue
      const pageMarks = marks.get(annotation.page) ?? []
      pageMarks.push(annotation)
      marks.set(annotation.page, pageMarks)
    }
    return marks
  }, [annotations])

  const recordSize = useCallback((page: number, ratio: number) => {
    if (!Number.isFinite(ratio) || ratio <= 0) return
    setMeasurements(previous => {
      if (previous.ratios.size && (previous.ratios.get(page) ?? previous.fallback) === ratio) return previous
      return { fallback: previous.ratios.size ? previous.fallback : ratio,
        ratios: new Map(previous.ratios).set(page, ratio) }
    })
  }, [])

  const refreshViewport = useCallback(() => {
    const host = hostRef.current
    if (!host) return
    const next = readViewport(host)
    const previous = lastViewport.current
    if (!sameViewport(previous, next)) {
      lastViewport.current = next
      setViewport(next)
    }
  }, [hostRef])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    let index = startingIndex.current
    let fraction = startPosition.current.offset ?? 0
    let left = (startPosition.current.horizontal ?? 0) * layout.width
    const previous = committedLayout.current
    if (previous) {
      const top = lastViewport.current.top
      left = lastViewport.current.left * layout.width / previous.width
      index = pageAt(previous, top + 1.5)
      fraction = Math.min(1, Math.max(0, (top - previous.offsets[index]) / previous.heights[index]))
    }
    committedLayout.current = layout
    const position = layout.offsets[index] + layout.heights[index] * fraction
    // Avoid interrupting iOS momentum when a measurement below the viewport has no effect.
    if (Math.abs(host.scrollTop - position) > 1) host.scrollTop = position
    if (Math.abs(host.scrollLeft - left) > 1) host.scrollLeft = left
    refreshViewport()
  }, [hostRef, layout, refreshViewport])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    let frame = 0
    const update = () => {
      // Keep the position current even if a page measurement lands before this frame paints.
      lastViewport.current = readViewport(host)
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setViewport(previous => sameViewport(previous, lastViewport.current) ? previous : lastViewport.current)
      })
    }
    const resize = new ResizeObserver(update)
    resize.observe(host)
    const onScroll = () => {
      update()
      const measured = committedLayout.current
      if (measured) onPositionChange(readPosition(measured, host))
    }
    host.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      host.removeEventListener('scroll', onScroll)
    }
  }, [hostRef, onPositionChange])

  useImperativeHandle(navigationRef, () => ({
    jump(page: number) {
      const host = hostRef.current
      if (!host) return
      host.scrollTop = layout.offsets[page - 1]
      refreshViewport()
      onPositionChange(readPosition(layout, host))
    },
    getPosition() {
      const host = hostRef.current
      return host && committedLayout.current ? readPosition(committedLayout.current, host) : undefined
    },
  }), [hostRef, layout, refreshViewport, onPositionChange])

  const top = committedLayout.current ? viewport.top : layout.offsets[startingIndex.current]
  const first = pageAt(layout, top)
  const active = pageAt(layout, top + Math.min(48, viewport.height * 0.12, layout.heights[first] / 2))
  const last = pageAt(layout, top + viewport.height)
  const start = painted ? Math.max(0, first - 1) : active
  // Paint every visible page, including short landscape pages, and at most one neighbor on either side.
  const stop = painted ? Math.min(pdf.numPages - 1, last + 1) : active
  const markPainted = useCallback(() => setPainted(true), [])

  useEffect(() => {
    if (viewport.height) onPageChange(active + 1)
  }, [active, onPageChange, viewport.height])

  useEffect(() => {
    if (selectedPage && (selectedPage - 1 < first || selectedPage - 1 > last)) onSelection(undefined)
  }, [first, last, onSelection, selectedPage])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const selectionChanged = () => onSelection(readPdfSelection(host))
    document.addEventListener('selectionchange', selectionChanged)
    return () => document.removeEventListener('selectionchange', selectionChanged)
  }, [hostRef, onSelection])

  return <div className="pdf-pages" style={{
    width: pageWidth,
    height: layout.end,
    // Keep the last page's top reachable as soon as the search panel or keyboard closes.
    minHeight: `calc(${layout.offsets[pdf.numPages - 1]}px + 100%)`,
  }}>
    {Array.from({ length: stop - start + 1 }, (_, offset) => {
      const index = start + offset
      const page = index + 1
      return <div className="pdf-page-slot" data-pdf-page={page} key={page}
        style={{ top: layout.offsets[index], height: layout.heights[index] }}>
        <PageCanvas pdf={pdf} page={page} width={width} zoom={zoom} query={query}
          annotations={marksByPage.get(page) ?? noMarks}
          onMeasure={recordSize} onPaint={markPainted} />
      </div>
    })}
  </div>
}

function pageAt(layout: Layout, position: number) {
  let start = 0
  let end = layout.offsets.length - 1
  while (start < end) {
    const middle = Math.ceil((start + end) / 2)
    if (layout.offsets[middle] <= position) start = middle
    else end = middle - 1
  }
  return start
}

function readViewport(host: HTMLDivElement): Viewport {
  return { left: Math.max(0, host.scrollLeft), top: Math.max(0, host.scrollTop), height: host.clientHeight }
}

function readPosition(layout: Layout, host: HTMLDivElement): PdfReadingPosition {
  const top = Math.max(0, host.scrollTop)
  const index = pageAt(layout, top + 1.5)
  const roundFraction = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000
  return {
    page: index + 1,
    offset: roundFraction((top - layout.offsets[index]) / layout.heights[index]),
    horizontal: roundFraction(host.scrollLeft / layout.width),
  }
}

function sameViewport(first: Viewport, second: Viewport) {
  return first.left === second.left && first.top === second.top && first.height === second.height
}
