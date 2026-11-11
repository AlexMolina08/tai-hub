import { createHash } from 'node:crypto'
import { build } from 'esbuild'

// Fixed bootstrap, allowed by its hash in both parent and opaque iframe CSPs.
export const bootstrap = `(() => {
  let worker, token, workerUrl;
  const send = data => parent.postMessage({ ...data, token }, '*');
  addEventListener('message', event => {
    if (event.source !== parent || !event.data || typeof event.data.token !== 'string') return;
    const data = event.data;
    if (data.kind === 'init' && !worker) {
      token = data.token;
      workerUrl = URL.createObjectURL(new Blob([data.code], { type: 'text/javascript' }));
      worker = new Worker(workerUrl);
      worker.onmessage = event => { URL.revokeObjectURL(workerUrl); send(event.data); };
      worker.onerror = () => { URL.revokeObjectURL(workerUrl); send({ kind: 'error', message: 'El motor no pudo iniciarse.' }); };
      worker.postMessage({ kind: 'run', wasm: data.wasm, initdb: data.initdb, bundle: data.bundle, setup: data.setup, query: data.query });
    } else if (data.token === token && data.kind === 'cancel') {
      worker?.terminate(); URL.revokeObjectURL(workerUrl); worker = undefined; send({ kind: 'cancelled' });
    }
  });
  parent.postMessage({ kind: 'sandbox-ready' }, '*');
})();`
export const bootstrapHash = 'sha256-' + createHash('sha256').update(bootstrap).digest('base64')

export function labSandboxPlugin() {
  let compiled
  return {
    name: 'laboratory-isolated-sql',
    resolveId(id) { if (id === 'virtual:lab-sql') return '\0virtual:lab-sql' },
    async load(id) {
      if (id !== '\0virtual:lab-sql') return
      compiled ??= build({ entryPoints: ['src/lab/sql.worker.ts'], bundle: true, write: false, format: 'iife', platform: 'browser',
        target: 'safari16.4', minify: true, external: ['node:*'],
        define: { 'import.meta.url': JSON.stringify('https://invalid.example/sql-worker.js') } })
      const result = await compiled
      return `export const code = ${JSON.stringify(result.outputFiles[0].text)}; export const bootstrap = ${JSON.stringify(bootstrap)}; export const hash = ${JSON.stringify(bootstrapHash)};`
    },
    transformIndexHtml(html) { return html.replace("'LAB_SANDBOX_HASH'", `'${bootstrapHash}'`) },
  }
}
