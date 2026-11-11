import { readFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createServer } from 'vite'

const input = process.argv[2]
if (!input) throw new Error('Uso: npm run lab:review -- /ruta/privada/paquete.json')
const path = resolve(input)
if (!relative(process.cwd(), path).startsWith('..')) throw new Error('El paquete editorial debe estar fuera del repositorio público.')
const raw = await readFile(path, 'utf8')
if (Buffer.byteLength(raw) > 32 * 1024 ** 2) throw new Error('El paquete supera 32 MB.')
JSON.parse(raw)
const token = randomBytes(32).toString('hex')
const port = Number(process.env.TAI_REVIEW_PORT ?? 5195)
const base = '/tai-hub/'
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{ name: 'private-editorial-preview', configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const url = request.url?.split('?')[0]
      if (url !== base + '__lab-review' && url !== base + '__lab-review/package') return next()
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Referrer-Policy', 'no-referrer')
      if (request.method !== 'GET' || request.headers.host !== `127.0.0.1:${port}`) { response.statusCode = 403; return response.end() }
      if (url.endsWith('/package')) {
        if (request.headers['x-lab-review-token'] !== token) { response.statusCode = 403; return response.end() }
        response.setHeader('Content-Type', 'application/json'); return response.end(raw)
      }
      response.setHeader('Content-Type', 'text/html')
      response.end(await server.transformIndexHtml(base + '__lab-review', '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Revisión editorial privada</title><div id="root"></div><script type="module" src="/src/lab/review.tsx"></script></html>'))
    })
  } }],
})
await server.listen()
console.log(`Revisión editorial local; no cambia estados ni historial de estudio.\nhttp://127.0.0.1:${port}${base}__lab-review#${token}`)
