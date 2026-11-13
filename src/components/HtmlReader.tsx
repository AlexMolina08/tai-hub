import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, List, Maximize2, Minimize2 } from 'lucide-react'
import type { DriveLibrary, Resource } from '../drive'
import { safeLink } from '../resources'
import './html-reader.css'
import { readerScript } from './html-reader-script'

const limit = 32 * 1024 ** 2
const elements = new Set('a abbr article aside b blockquote br button caption code col colgroup dd details div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img kbd li main mark nav ol p pre s samp section small span strong style sub summary sup table tbody td th thead tfoot tr u ul'.split(' '))
const attributes = new Set('id class title lang dir role aria-label aria-labelledby aria-describedby aria-hidden colspan rowspan scope open start reversed type data-copy data-pdf-page'.split(' '))

// Only this application-owned script runs. Source document scripts are always removed.
// The iframe has an opaque origin, so even this helper cannot access the app or its Drive token.

/** Sanitize self-contained study documents; permit only the trusted reader helper. */
export function studyDocument(input: string): string {
  const template = document.createElement('template')
  template.innerHTML = input
  for (const element of Array.from(template.content.querySelectorAll('*'))) {
    if (!elements.has(element.localName)) { element.remove(); continue }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name
      const value = attribute.value
      if (name === 'href' && element.localName === 'a' && (value.startsWith('#') || safeLink(value))) continue
      if (name === 'src' && element.localName === 'img' && /^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(value)) continue
      if (['alt', 'width', 'height', 'loading'].includes(name) && element.localName === 'img') continue
      if (name === 'tabindex' && value === '0') continue
      if (!attributes.has(name)) element.removeAttribute(name)
    }
    if (element.localName === 'a' && !element.getAttribute('href')?.startsWith('#')) {
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noopener noreferrer')
    }
    if (element.localName === 'button') element.setAttribute('type', 'button')
  }
  const nonce = crypto.randomUUID()
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html{color-scheme:light}body{margin:0;color:#1a1a1a;background:#fff;font:17px/1.65 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre,.table-wrap{max-width:100%;overflow:auto}button{font:inherit;cursor:pointer}.copy-code{display:block;margin:.4rem 0 .8rem;padding:.3rem .65rem;background:#fff8e1;color:#714700;border:1px solid #c8820a;border-radius:5px}a{color:#825300}</style></head><body>${template.innerHTML}<style>@media (max-width:600px){nav.toc summary{min-height:44px}nav.toc a{display:flex;align-items:center;min-height:44px}button.copy-code{min-height:44px}}</style><script id="tai-reader-helper" nonce="${nonce}">${readerScript}</script></body></html>`
}

export function HtmlReader({ resource, library, connected, download, sectionId, closeDialog }: {
  resource: Resource; library: DriveLibrary; connected: boolean; download: () => void; sectionId?: string; closeDialog?: () => void
}) {
  const [document, setDocument] = useState<string>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [index, setIndex] = useState<{ canReturn: boolean }>()
  const frame = useRef<HTMLIFrameElement>(null)
  const wideButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    setDocument(undefined)
    setError('')
    setIndex(undefined)
    if (!connected) return
    let live = true
    if (resource.size > limit) { setError('El documento supera el límite de lectura de 32 MB. Puedes descargarlo.'); return }
    library.readBlob(resource.id, limit).then(blob => blob.text()).then(value => {
      if (live) setDocument(studyDocument(value))
    }).catch(() => { if (live) setError('No se pudieron cargar los apuntes. Comprueba el acceso a Drive y reintenta.') })
    return () => { live = false }
  }, [resource.id, resource.version, resource.size, library, connected, attempt])

  useEffect(() => {
    if (!expanded) return
    const previous = window.document.body.style.overflow
    window.document.body.style.overflow = 'hidden'
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', escape)
    return () => { window.document.body.style.overflow = previous; window.removeEventListener('keydown', escape) }
  }, [expanded])

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return
      if (event.data?.type === 'tai-study-escape') {
        if (closeDialog) closeDialog()
        else if (expanded) {
          setExpanded(false)
          wideButton.current?.focus({ preventScroll: true })
        }
      }
      if (event.data?.type === 'tai-study-index-state' && typeof event.data.canReturn === 'boolean') {
        setIndex({ canReturn: event.data.canReturn })
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [closeDialog, expanded])

  return <section className={`html-reader${expanded ? ' html-reader-expanded' : ''}`} aria-label="Lector de apuntes ampliados">
    <div className="html-reader-toolbar">
      {!closeDialog && <button ref={wideButton} className="button" disabled={!connected || !document} aria-pressed={expanded}
        aria-label={expanded ? 'Salir de lectura amplia' : 'Lectura amplia'} title={expanded ? 'Salir de lectura amplia' : undefined}
        onClick={() => setExpanded(value => !value)}>
        {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}<span>{expanded ? 'Salir de lectura amplia' : 'Lectura amplia'}</span>
      </button>}
      {index && <button className="button" onClick={() => frame.current?.contentWindow?.postMessage({ type: 'tai-study-index' }, '*')}>
        {index.canReturn ? <ArrowLeft size={16} /> : <List size={16} />}{index.canReturn ? 'Volver a la lectura' : 'Índice'}
      </button>}
      <button className="button html-reader-download" disabled={!connected} onClick={download} aria-label="Descargar HTML" title="Descargar HTML">
        <Download size={16} /><span>Descargar HTML</span>
      </button>
    </div>
    {!connected ? <p className="form-hint" role="status">Conecta Drive para leer estos apuntes privados.</p>
      : error ? <div role="alert"><p>{error}</p><button className="button" onClick={() => setAttempt(value => value + 1)}>Reintentar</button></div>
        : !document ? <p className="form-hint" role="status">Cargando apuntes…</p>
          : <iframe ref={frame} title={resource.title} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={document}
            onLoad={() => { if (sectionId) frame.current?.contentWindow?.postMessage({ type: 'tai-study-section', id: sectionId }, '*') }} />}
  </section>
}
