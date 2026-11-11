import { code, bootstrap, hash } from 'virtual:lab-sql'
import wasmUrl from '../../node_modules/@electric-sql/pglite/dist/pglite.wasm?url'
import initdbUrl from '../../node_modules/@electric-sql/pglite/dist/initdb.wasm?url'
import bundleUrl from '../../node_modules/@electric-sql/pglite/dist/pglite.data?url'

export interface SqlResult { columns: string[]; rows: unknown[][] }
let assets: Promise<ArrayBuffer[]> | undefined
async function loadAssets() {
  assets ??= Promise.all([wasmUrl, initdbUrl, bundleUrl].map(async url => {
    const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error('No se pudo descargar el motor SQL. Conecta y vuelve a intentarlo.')
    return response.arrayBuffer()
  })).catch(error => { assets = undefined; throw error })
  return assets
}
async function availableAssets(signal?: AbortSignal) {
  if (!signal) return loadAssets()
  return new Promise<ArrayBuffer[]>((resolve, reject) => {
    const abort = () => reject(new Error('Ejecución cancelada. Puedes reiniciar sin perder tu consulta.'))
    signal.addEventListener('abort', abort, { once: true })
    void loadAssets().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

/** Opaque origin + CSP + disposable worker. No session, Drive token, storage or network reaches the executor. */
export async function runSql(setup: string, query: string, signal?: AbortSignal, timeoutMs = 12_000): Promise<SqlResult> {
  signal?.throwIfAborted()
  const [wasm, initdb, bundle] = await availableAssets(signal)
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const token = crypto.randomUUID()
    const frame = document.createElement('iframe')
    frame.title = 'Motor SQL aislado'; frame.hidden = true; frame.setAttribute('sandbox', 'allow-scripts')
    const csp = `default-src 'none'; script-src '${hash}' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script>${bootstrap}<\/script>`
    let finished = false
    const clean = () => {
      clearTimeout(timer); window.removeEventListener('message', receive); signal?.removeEventListener('abort', abort)
      frame.contentWindow?.postMessage({ kind: 'cancel', token }, '*')
      // Give the iframe bootstrap an event-loop turn to terminate its worker before detaching.
      setTimeout(() => frame.remove(), 100)
    }
    const finish = (error?: Error, result?: SqlResult) => {
      if (finished) return
      finished = true; clean(); if (error) reject(error); else resolve(result!)
    }
    const abort = () => finish(new Error('Ejecución cancelada. Puedes reiniciar sin perder tu consulta.'))
    const timer = setTimeout(() => finish(new Error('Se ha alcanzado el límite de ejecución. El motor se reiniciará.')), timeoutMs)
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || !event.data || typeof event.data !== 'object') return
      const data = event.data
      if (data.kind === 'sandbox-ready') {
        frame.contentWindow!.postMessage({ kind: 'init', token, code, wasm, initdb, bundle, setup, query }, '*')
        return
      }
      if (data.token !== token) return
      if (data.kind === 'error') {
        const error = new Error(typeof data.message === 'string' ? data.message : 'Error SQL.')
        if (data.stage === 'query') error.name = 'SqlQueryError'
        finish(error)
      }
      if (data.kind === 'result') {
        if (!Array.isArray(data.rows) || data.rows.length > 200 || !data.rows.every(Array.isArray)
          || !Array.isArray(data.columns) || !data.columns.every((v: unknown) => typeof v === 'string')
          || JSON.stringify(data).length > 110_000) finish(new Error('Respuesta no válida del motor.'))
        else finish(undefined, { rows: data.rows, columns: data.columns })
      }
    }
    window.addEventListener('message', receive); signal?.addEventListener('abort', abort, { once: true })
    document.body.append(frame)
  })
}
