import { bootstrap, hash } from 'virtual:lab-html'
import type { HtmlCheck } from './model'

const elements = new Set('a abbr article aside b blockquote br button caption code col colgroup dd details div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr i input kbd label legend li main mark nav ol option p pre s samp section select small span strong sub summary sup table tbody td textarea th thead tfoot tr u ul'.split(' '))
const attributes = new Set('id class title lang dir role aria-label aria-labelledby aria-describedby aria-hidden colspan rowspan scope headers open start reversed type value name for placeholder disabled checked selected multiple required maxlength pattern min max step rows cols style tabindex'.split(' '))
export function previewDocument(html: string, css: string): string {
  if (html.length + css.length > 50_000) throw new Error('La vista admite hasta 50 KB de HTML y CSS.')
  const template = document.createElement('template')
  template.innerHTML = html
  const nodes = [...template.content.querySelectorAll('*')]
  if (nodes.length > 200) throw new Error('La vista admite hasta 200 elementos.')
  for (const element of nodes) {
    if (!elements.has(element.localName)) { element.remove(); continue }
    for (const attribute of [...element.attributes]) if (!attributes.has(attribute.name)) element.removeAttribute(attribute.name)
    if (element.localName === 'button') element.setAttribute('type', 'button')
    if (element.getAttribute('type') === 'file') element.setAttribute('type', 'text')
  }
  const csp = `default-src 'none'; script-src '${hash}'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${css.replace(/<\/style/gi, '<\\/style')}</style><body>${template.innerHTML}<script>${bootstrap}<\/script></body></html>`
}

/** The helper measures real DOM/CSS; expected answers remain in the parent and are never evaluated as code. */
export function inspectHtml(container: HTMLElement, source: { html: string; css: string }, width: number,
  checks: HtmlCheck[], signal?: AbortSignal): Promise<(string | null)[]> {
  const documentSource = previewDocument(source.html, source.css)
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.title = 'Resultado HTML y CSS'
    frame.referrerPolicy = 'no-referrer'
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.style.width = width + 'px'
    frame.srcdoc = documentSource
    const token = crypto.randomUUID()
    let finished = false
    const finish = (error?: Error, values?: (string | null)[]) => {
      if (finished) return
      finished = true; clearTimeout(timer); window.removeEventListener('message', receive); signal?.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(values!)
    }
    const abort = () => finish(new Error('Vista cancelada. El código está guardado.'))
    const timer = setTimeout(() => finish(new Error('La vista no respondió a tiempo.')), 4000)
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || !event.data) return
      if (event.data.kind === 'html-ready') {
        frame.contentWindow?.postMessage({ kind: 'inspect', token, checks: checks.map(({ selector, kind, property }) => ({ selector, kind, property })) }, '*')
      } else if (event.data.kind === 'html-result' && event.data.token === token) {
        const values = event.data.values
        if (!Array.isArray(values) || values.length !== checks.length || !values.every(v => v === null || (typeof v === 'string' && v.length <= 2000))) {
          finish(new Error('La vista devolvió una respuesta no válida.'))
        } else finish(undefined, values)
      } else if (event.data.kind === 'html-error' && event.data.token === token) finish(new Error('Un selector de esta actividad no es válido.'))
    }
    window.addEventListener('message', receive); signal?.addEventListener('abort', abort, { once: true })
    // Navigating a connected iframe adds entries to the browser's joint session history.
    container.replaceChildren(frame)
  })
}
