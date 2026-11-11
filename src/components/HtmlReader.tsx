import { useEffect, useRef, useState } from 'react'
import { Download, Maximize2, Minimize2 } from 'lucide-react'
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
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html{color-scheme:light;scroll-behavior:smooth}body{margin:0;color:#1a1a1a;background:#fff;font:17px/1.65 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre,.table-wrap{max-width:100%;overflow:auto}button{font:inherit;cursor:pointer}.copy-code{display:block;margin:.4rem 0 .8rem;padding:.3rem .65rem;background:#fff8e1;color:#714700;border:1px solid #c8820a;border-radius:5px}a{color:#825300}</style></head><body>${template.innerHTML}<script id="tai-reader-helper" nonce="${nonce}">${readerScript}</script></body></html>`
}

export function HtmlReader({ resource, library, connected, download, sectionId }: {
  resource: Resource; library: DriveLibrary; connected: boolean; download: () => void; sectionId?: string
}) {
  const [document, setDocument] = useState<string>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    setDocument(undefined)
    setError('')
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
      if (event.source === frame.current?.contentWindow && event.data?.type === 'tai-study-escape') setExpanded(false)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])

  return <section className={`html-reader${expanded ? ' html-reader-expanded' : ''}`} aria-label="Lector de apuntes ampliados">
    <div className="html-reader-toolbar">
      <span>Lectura privada</span>
      <div className="actions">
        <button className="button" disabled={!connected || !document} aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{expanded ? 'Salir de lectura amplia' : 'Lectura amplia'}
        </button>
        <button className="button" disabled={!connected} onClick={download}><Download size={16} />Descargar HTML</button>
      </div>
    </div>
    {!connected ? <p className="form-hint" role="status">Conecta Drive para leer estos apuntes privados.</p>
      : error ? <div role="alert"><p>{error}</p><button className="button" onClick={() => setAttempt(value => value + 1)}>Reintentar</button></div>
        : !document ? <p className="form-hint" role="status">Cargando apuntes…</p>
          : <iframe ref={frame} title={resource.title} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={document}
            onLoad={() => { if (sectionId) frame.current?.contentWindow?.postMessage({ type: 'tai-study-section', id: sectionId }, '*') }} />}
  </section>
}
