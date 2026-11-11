import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Only emitted public application assets enter this manifest. Drive responses never enter the service-worker cache. */
export function labOfflinePlugin() {
  let config
  return {
    name: 'laboratory-offline-assets', apply: 'build',
    configResolved(value) { config = value },
    async closeBundle() {
      const output = resolve(config.root, config.build.outDir)
      const files = ['index.html', 'mark.svg', 'licenses/runtime-notices.txt', ...(await readdir(resolve(output, 'assets'))).map(name => 'assets/' + name)]
      const entries = []
      for (const name of files) {
        const group = /pyodide|python_stdlib|python-assets/.test(name) ? 'python'
          : /\.(?:wasm|data)$/.test(name) && /pglite|initdb/.test(name) ? 'sql'
          : /\.(?:html|svg|js|css|txt)$/.test(name) ? 'shell' : undefined
        if (!group) continue
        const bytes = await readFile(resolve(output, name))
        entries.push({ url: config.base + name, group, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
      }
      const revision = createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16)
      const manifest = { revision, base: config.base, entries }
      const source = await readFile(resolve(config.root, 'src/lab/offline-worker.js'), 'utf8')
      await writeFile(resolve(output, 'lab-offline-worker.js'), `const manifest = ${JSON.stringify(manifest)};\n${source}`)
    },
  }
}
