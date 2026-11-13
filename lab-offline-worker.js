const manifest = {"revision":"1e300af5af6dea3a","base":"/tai-hub/","entries":[{"url":"/tai-hub/index.html","group":"shell","bytes":1542,"sha256":"8a24a784b01f3a8f423952aa68b9ef7ea909517000873242118dca0624ffc281"},{"url":"/tai-hub/mark.svg","group":"shell","bytes":384,"sha256":"e4d6ba267f82f95f485e0394bcc8ad7ad00edf879145beff17ad3172b0498bd3"},{"url":"/tai-hub/licenses/runtime-notices.txt","group":"shell","bytes":42896,"sha256":"7da1edc4b40bd865d53f1a544046444a83d08ec95020b26bafdffdecc18e8fe4"},{"url":"/tai-hub/assets/Laboratory-BbTQG5xK.css","group":"shell","bytes":21875,"sha256":"1b0fcc5c118630aff48b5111c74f01e4fd1fc460f16bf3671ca1cf0fe0a5a844"},{"url":"/tai-hub/assets/Laboratory-fqsCVZk8.js","group":"shell","bytes":341169,"sha256":"aa2de9d378f845bff1133c9fb5f7240767113a91f17c48cb31dcde5097b31579"},{"url":"/tai-hub/assets/PdfReader-CquVbwGg.css","group":"shell","bytes":8534,"sha256":"a4738442727d2fc251a647bc97da88ec14e03ff081b6a402927a79016bc588be"},{"url":"/tai-hub/assets/PdfReader-pOoQCxBS.js","group":"shell","bytes":24858,"sha256":"aa98c54344eef35f49f7145f60dc2d9e247e0c2469d12fe61551ab9eb81462c6"},{"url":"/tai-hub/assets/document-JSHY_bA8.js","group":"shell","bytes":509557,"sha256":"8797708fc000cfe55057dd683374a495cc53831f897e49a0cb14da95598330e3"},{"url":"/tai-hub/assets/index-CQ15J4gl.css","group":"shell","bytes":20052,"sha256":"4d32a694f4e5806ecb23cd611677f0c3a40f8f68c269deea9b2e925da8319687"},{"url":"/tai-hub/assets/index-DnsFN_p6.js","group":"shell","bytes":353034,"sha256":"93b860017d7294fc14b1980114f6a9120d34847f1d8fd2b71cc977dad8944b7b"},{"url":"/tai-hub/assets/index-SgflaWHb.js","group":"shell","bytes":3688,"sha256":"790ffcafca1c44893312f587fa65798bc5ad32a1032f5b94f317f02fa8acd56a"},{"url":"/tai-hub/assets/index.worker-iW8MJFPV.js","group":"shell","bytes":22073,"sha256":"b1a6cf93ed99dbc6766c7de1fed0a53503be52f427694f7e82f9c9ae0035506d"},{"url":"/tai-hub/assets/initdb-BJaOLL_I.wasm","group":"sql","bytes":298788,"sha256":"63d8b9d54110f827711545a338a643621e65b5658f09e1acfcf36073be365ce2"},{"url":"/tai-hub/assets/pglite-BE2Di5Vw.data","group":"sql","bytes":6242272,"sha256":"d73cf4ba1b0bf92f80f088ce7d23b17f9bc175327d7584ec2a713b27e9758c31"},{"url":"/tai-hub/assets/pglite-VfT9wtrq.wasm","group":"sql","bytes":9086480,"sha256":"5256d9ac379f631355f41ab30291e6a6d9f854242b5ee2a2d0940e28041d3fca"},{"url":"/tai-hub/assets/program-runner-EuO5yYCl.js","group":"shell","bytes":5075,"sha256":"898877ae13074bc37f6c01e2e705e72e5d4c55398d6ce08eeab89f31c3ec9e20"},{"url":"/tai-hub/assets/pyodide-lock-y3tUuWGz.json","group":"python","bytes":119077,"sha256":"5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010"},{"url":"/tai-hub/assets/pyodide.asm-DoBEEsqh.wasm","group":"python","bytes":9598218,"sha256":"cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6"},{"url":"/tai-hub/assets/python-assets-BZsvm9Pc.js","group":"python","bytes":1069388,"sha256":"b1dba73bed13ebc287bf219f4320af5cac0278bfe7f4361fc15652247e264261"},{"url":"/tai-hub/assets/python_stdlib-Dms11Th8.zip","group":"python","bytes":2545637,"sha256":"fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a"},{"url":"/tai-hub/assets/sql-runner-CF7uOk8F.js","group":"shell","bytes":527356,"sha256":"3caaecab52509d8eca27b1f08a9f0d8348b5225b70d7101f1e38095e34363f93"}]};
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
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (event.request.mode === 'navigate' && [manifest.base, manifest.base + 'index.html'].includes(url.pathname)) {
    // A prepared application opens without a network round trip, including captive portals and expired sessions.
    event.respondWith((async () => (await (await caches.open(cacheName)).match(manifest.base + 'index.html')) ?? fetch(event.request))())
  } else if (allowed.has(url.href)) {
    event.respondWith((async () => (await (await caches.open(cacheName)).match(url.href)) ?? fetch(event.request))())
  }
})
