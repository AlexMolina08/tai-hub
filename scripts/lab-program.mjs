import { createHash } from 'node:crypto'
import { build } from 'esbuild'

// The parent supplies only source, input and public interpreter assets to this opaque frame.
const bootstrap = `(() => {
  let worker, token, initialized = false, lines = 0, bytes = 0;
  const send = data => parent.postMessage({ ...data, token }, '*');
  const stop = () => { worker?.terminate(); worker = undefined; };
  addEventListener('message', event => {
    if (event.source !== parent || !event.data || typeof event.data.token !== 'string') return;
    const data = event.data;
    if (data.kind === 'init' && !initialized) {
      initialized = true; token = data.token;
      const url = 'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(data.code)));
      worker = new Worker(url, { type: 'module' });
      worker.onmessage = event => {
        const value = event.data;
        if (!value || typeof value !== 'object') return;
        if (value.kind === 'output') {
          if (typeof value.text !== 'string' || ++lines > 100 || (bytes += value.text.length) > 16000) {
            stop(); send({ kind: 'output-limit' });
          } else send({ kind: 'output', text: value.text });
        } else if (['running', 'done', 'error', 'output-limit'].includes(value.kind)) {
          send({ kind: value.kind, message: typeof value.message === 'string' ? value.message.slice(0, 1800) : undefined });
          if (value.kind !== 'running') stop();
        }
      };
      worker.onerror = event => { stop(); send({ kind: 'error', message: String(event.message).slice(0, 1800) }); };
      worker.postMessage({ source: data.source, input: data.input, wasm: data.wasm, stdlib: data.stdlib, lock: data.lock });
    } else if (data.token === token && data.kind === 'cancel') stop();
  });
  parent.postMessage({ kind: 'sandbox-ready' }, '*');
})();`
const hash = 'sha256-' + createHash('sha256').update(bootstrap).digest('base64')
export function labProgramPlugin() {
  let compiled
  return {
    name: 'laboratory-isolated-program',
    resolveId(id) { if (['virtual:lab-program', 'virtual:lab-python'].includes(id)) return '\0' + id },
    async load(id) {
      if (id === '\0virtual:lab-program') return `export const bootstrap = ${JSON.stringify(bootstrap)}; export const hash = ${JSON.stringify(hash)};`
      if (id !== '\0virtual:lab-python') return
      compiled ??= build({ entryPoints: ['src/lab/python.worker.ts'], bundle: true, write: false, format: 'esm',
        platform: 'browser', target: 'safari16.4', minify: true, external: ['node:*', 'ws'] })
      const result = await compiled
      return `export const code = ${JSON.stringify(result.outputFiles[0].text)};`
    },
    transformIndexHtml(html) { return html.replace("'LAB_PROGRAM_HASH'", `'${hash}'`) },
  }
}
