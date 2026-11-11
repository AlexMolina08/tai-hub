import { bootstrap, hash } from 'virtual:lab-program'

export interface ProgramResult {
  status: 'done' | 'error' | 'timeout' | 'output-limit'
  output: string[]
  error?: string
}
export function javascriptProgram(source: string, input: unknown): string {
  return `const send = postMessage.bind(globalThis);
let lines = 0, bytes = 0;
function output(...values) {
  const text = values.map(v => typeof v === 'string' ? v : String(JSON.stringify(v))).join(' ');
  if (++lines > 100 || (bytes += text.length) > 16000) { send({kind:'output-limit'}); throw Error('Salida limitada.'); }
  send({kind:'output', text});
}
globalThis.console = {log:output, error:output, warn:output};
const input = ${JSON.stringify(input)};
send({kind:'running'});
try { await (async () => {\n${source}\n})(); send({kind:'done'}); }
catch(error) { send({kind:'error', message:String(error?.message ?? error).slice(0,1800)}); }`
}
async function prepare(language: 'python' | 'javascript', source: string, input: unknown, signal?: AbortSignal) {
  const preparing = language === 'python' ? import('./python-assets').then(module => module.pythonAssets())
    : Promise.resolve({ code: javascriptProgram(source, input) })
  if (!signal) return preparing
  return new Promise<Awaited<typeof preparing>>((resolve, reject) => {
    const abort = () => reject(new Error('Ejecución cancelada. El código está guardado.'))
    signal.addEventListener('abort', abort, { once: true })
    void preparing.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

/** Each run has a fresh interpreter, opaque origin and no credential, network or persistent-storage access. */
export async function runProgram(language: 'python' | 'javascript', source: string, input: unknown,
  signal?: AbortSignal, progress?: (message: string) => void): Promise<ProgramResult> {
  if (source.length > 50_000 || JSON.stringify(input).length > 16_000) throw new Error('El código o la entrada superan el límite.')
  signal?.throwIfAborted()
  progress?.(language === 'python' ? 'Preparando Python…' : 'Preparando JavaScript…')
  const assets = await prepare(language, source, input, signal)
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const token = crypto.randomUUID()
    const frame = document.createElement('iframe')
    frame.hidden = true; frame.title = 'Motor de código aislado'; frame.setAttribute('sandbox', 'allow-scripts')
    const csp = `default-src 'none'; script-src '${hash}' 'wasm-unsafe-eval'; worker-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script>${bootstrap}<\/script>`
    const output: string[] = []
    let finished = false, started = false, initialized = false, bytes = 0
    const finish = (result?: ProgramResult, error?: Error) => {
      if (finished) return
      finished = true; clearTimeout(timer); window.removeEventListener('message', receive)
      signal?.removeEventListener('abort', abort)
      frame.contentWindow?.postMessage({ kind: 'cancel', token }, '*')
      setTimeout(() => frame.remove(), 100)
      if (error) reject(error); else resolve(result!)
    }
    const abort = () => finish(undefined, new Error('Ejecución cancelada. El código está guardado.'))
    let timer = setTimeout(() => finish(undefined, new Error('El motor no pudo arrancar a tiempo. Vuelve a intentarlo.')), 20_000)
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || !event.data || typeof event.data !== 'object') return
      const data = event.data
      if (data.kind === 'sandbox-ready' && !initialized) {
        initialized = true
        frame.contentWindow!.postMessage({ kind: 'init', token, ...assets, source, input }, '*'); return
      }
      if (data.token !== token) return
      if (data.kind === 'running' && !started) {
        started = true; clearTimeout(timer); progress?.('Ejecutando código…')
        timer = setTimeout(() => finish({ status: 'timeout', output, error: 'Límite de ejecución: 2 segundos. El motor se ha detenido.' }), 2000)
      } else if (data.kind === 'output') {
        if (typeof data.text !== 'string' || output.length >= 100 || (bytes += data.text.length) > 16_000) {
          finish({ status: 'output-limit', output, error: 'La salida supera 100 líneas o 16 KB.' })
        } else output.push(data.text)
      } else if (data.kind === 'output-limit') finish({ status: 'output-limit', output, error: 'La salida supera 100 líneas o 16 KB.' })
      else if (data.kind === 'done') finish({ status: 'done', output })
      else if (data.kind === 'error') {
        const message = typeof data.message === 'string' ? data.message.slice(0, 1800) : 'Error de ejecución.'
        if (started || language === 'javascript') finish({ status: 'error', output, error: message })
        else finish(undefined, new Error(message))
      }
    }
    window.addEventListener('message', receive); signal?.addEventListener('abort', abort, { once: true })
    document.body.append(frame)
  })
}
