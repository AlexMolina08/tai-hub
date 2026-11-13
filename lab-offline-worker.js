const manifest = {"revision":"1020a3f69b4ce215","base":"/tai-hub/","entries":[{"url":"/tai-hub/index.html","group":"shell","bytes":1542,"sha256":"4ce71ec5dd5a482cf543a3912ce645ced18208730217cf24dbc36238313a748a"},{"url":"/tai-hub/mark.svg","group":"shell","bytes":384,"sha256":"e4d6ba267f82f95f485e0394bcc8ad7ad00edf879145beff17ad3172b0498bd3"},{"url":"/tai-hub/licenses/runtime-notices.txt","group":"shell","bytes":42896,"sha256":"7da1edc4b40bd865d53f1a544046444a83d08ec95020b26bafdffdecc18e8fe4"},{"url":"/tai-hub/assets/Laboratory-dmWPUcEJ.js","group":"shell","bytes":371218,"sha256":"c99b4f04420e46ea8dc96b4e038942355db87885ee4a9f39c14575d505cfcbff"},{"url":"/tai-hub/assets/Laboratory-mPpqr7O3.css","group":"shell","bytes":36863,"sha256":"9683fb2c4b1790fb2c1b99de4581a0ed10a2b821a874722a2b3fbb5093620216"},{"url":"/tai-hub/assets/PdfReader-CxLstiI5.css","group":"shell","bytes":10468,"sha256":"f6d234154b2b6f6f9d9e174f7d8ec7d19ea0177f1c9a283005e21b6d664a5896"},{"url":"/tai-hub/assets/PdfReader-UWhQGsbH.js","group":"shell","bytes":24795,"sha256":"362197756a1b7549d01778c1dcc3830786c911c69c73e9d76e24fe508f03fef3"},{"url":"/tai-hub/assets/document-TWcTDom1.js","group":"shell","bytes":509557,"sha256":"f6a689d038f9c5b1cbbcffcac5846fefd90641f1866442f7cde432bbe1e1e298"},{"url":"/tai-hub/assets/index-B_Iqek9R.css","group":"shell","bytes":21017,"sha256":"e8d0258402ff153b5d49d0c598917d3f959a8a8fe45badab5f692365c85aad63"},{"url":"/tai-hub/assets/index-CXGw9wjf.js","group":"shell","bytes":3688,"sha256":"0c31dd834768fc22c97bb4ac15dfb8170bd0c4bca10af5d6936d710acd416bdd"},{"url":"/tai-hub/assets/index-D4MZmmWO.js","group":"shell","bytes":360864,"sha256":"23184fa62eac07a78ceb1a36d2fd2316ce7d1bae3d6f20f29cac948fabec4bae"},{"url":"/tai-hub/assets/index.worker-iW8MJFPV.js","group":"shell","bytes":22073,"sha256":"b1a6cf93ed99dbc6766c7de1fed0a53503be52f427694f7e82f9c9ae0035506d"},{"url":"/tai-hub/assets/initdb-BJaOLL_I.wasm","group":"sql","bytes":298788,"sha256":"63d8b9d54110f827711545a338a643621e65b5658f09e1acfcf36073be365ce2"},{"url":"/tai-hub/assets/pglite-BE2Di5Vw.data","group":"sql","bytes":6242272,"sha256":"d73cf4ba1b0bf92f80f088ce7d23b17f9bc175327d7584ec2a713b27e9758c31"},{"url":"/tai-hub/assets/pglite-VfT9wtrq.wasm","group":"sql","bytes":9086480,"sha256":"5256d9ac379f631355f41ab30291e6a6d9f854242b5ee2a2d0940e28041d3fca"},{"url":"/tai-hub/assets/program-runner-BTbUzCoy.js","group":"shell","bytes":5075,"sha256":"8597fd54819e039661dba3f3a05430de5aab761a9f09ba8837a10ed95b10d547"},{"url":"/tai-hub/assets/pyodide-lock-y3tUuWGz.json","group":"python","bytes":119077,"sha256":"5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010"},{"url":"/tai-hub/assets/pyodide.asm-DoBEEsqh.wasm","group":"python","bytes":9598218,"sha256":"cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6"},{"url":"/tai-hub/assets/python-assets-BZsvm9Pc.js","group":"python","bytes":1069388,"sha256":"b1dba73bed13ebc287bf219f4320af5cac0278bfe7f4361fc15652247e264261"},{"url":"/tai-hub/assets/python_stdlib-Dms11Th8.zip","group":"python","bytes":2545637,"sha256":"fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a"},{"url":"/tai-hub/assets/sql-runner-CF7uOk8F.js","group":"shell","bytes":527356,"sha256":"3caaecab52509d8eca27b1f08a9f0d8348b5225b70d7101f1e38095e34363f93"}]};
/* Build prepends a manifest containing public assets only. No tokens, packages or study history belong in Cache Storage. */
const cacheName = 'tai-lab-public-' + manifest.revision
const allowed = new Set(manifest.entries.map(entry => new URL(entry.url, self.location.origin).href))
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
async function status() {
  const cache = await caches.open(cacheName)
  const present = await Promise.all(manifest.entries.map(async entry => !!await cache.match(entry.url)))
  const ready = group => manifest.entries.every((entry, index) => entry.group !== group || present[index])
  return { revision: manifest.revision, shell: ready('shell'), sql: ready('sql'), python: ready('python'),
    bytes: manifest.entries.reduce((sum, entry, index) => sum + (present[index] ? entry.bytes : 0), 0),
    totalBytes: manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0) }
}
self.addEventListener('message', event => {
  const port = event.ports[0]
  if (!port || !['lab-offline-status', 'lab-offline-prepare'].includes(event.data?.kind)) return
  event.waitUntil((async () => {
    try {
      if (event.data.kind === 'lab-offline-prepare') {
        const cache = await caches.open(cacheName)
        const entries = manifest.entries.filter(entry => entry.group === 'shell' || event.data[entry.group] === true)
        let done = 0
        for (const entry of entries) {
          if (!await cache.match(entry.url)) {
            const response = await fetch(entry.url, { credentials: 'omit', cache: 'no-store' })
            if (!response.ok || response.type === 'opaque') throw new Error('No se pudo descargar un archivo de la aplicación.')
            const bytes = await response.clone().arrayBuffer()
            const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
            if (hash !== entry.sha256) throw new Error('La aplicación cambió durante la descarga. Recarga antes de prepararla de nuevo.')
            await cache.put(entry.url, response)
          }
          done += entry.bytes
          port.postMessage({ progress: done })
        }
        // A complete replacement exists before deleting old public application caches.
        if ((await status()).shell) {
          for (const name of await caches.keys()) if (name.startsWith('tai-lab-public-') && name !== cacheName) await caches.delete(name)
        }
      }
      port.postMessage({ result: await status() })
    } catch (error) { port.postMessage({ error: error instanceof Error ? error.message : 'No se pudo guardar el acceso sin conexión.' }) }
  })())
})
async function navigate(request) {
  const cached = await (await caches.open(cacheName)).match(manifest.base + 'index.html')
  if (!cached) return fetch(request)
  if (!self.navigator.onLine) return cached
  try {
    const response = await fetch(request, { cache: 'no-cache', signal: AbortSignal.timeout(3000) })
    return response.ok ? response : cached
  } catch { return cached }
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (event.request.mode === 'navigate' && [manifest.base, manifest.base + 'index.html'].includes(url.pathname)) {
    event.respondWith(navigate(event.request))
  } else if (allowed.has(url.href)) {
    event.respondWith((async () => (await (await caches.open(cacheName)).match(url.href)) ?? fetch(event.request))())
  }
})
