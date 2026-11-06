import { createHash } from 'node:crypto'
import type { BrowserContext, Route } from '@playwright/test'
import type { PdfAnnotation } from '../src/pdf/model'

interface MockFile {
  id: string
  name: string
  mimeType: string
  size: string
  description?: string
  md5Checksum?: string
  headRevisionId?: string
  appProperties: Record<string, string>
  ownedByMe: boolean
  trashed?: boolean
  webViewLink?: string
  webContentLink?: string
}

const driveScope = 'https://www.googleapis.com/auth/drive.file'
const accountId = 'sample-account'

export function fixturePdf(pages: string[], size = { width: 320, height: 440 }) {
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  pages.forEach((text, index) => {
    const content = text ? `BT /F1 15 Tf 12 ${size.height - 35} Td (${text}) Tj ET` : '12 405 m 100 410 l S'
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.width} ${size.height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`)
    objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`)
  })
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf, 'latin1')
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    return String(offset).padStart(10, '0') + ' 00000 n \n'
  })
  const start = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

export class DriveFixture {
  readonly mediaReads: string[] = []
  readonly redirectPrompts: (string | null)[] = []
  requireInteractiveLogin = false
  private files = new Map<string, MockFile>()
  private media = new Map<string, Buffer>()
  private nextId = 1
  private rejectToken = false
  private revisions = new Map<string, { id: string; originalFilename: string; body: Buffer }>()

  readonly firstPdf = fixturePdf(['Página inicial', 'Observación objetivo de la segunda página'])
  readonly secondPdf = fixturePdf(['Observación objetivo del otro PDF'])
  readonly videoId = 'test-video'

  constructor() {
    this.resource('test-pdf-one', 'Documento de prueba', 'pdf', this.firstPdf)
    this.resource('test-pdf-two', 'Segundo documento', 'pdf', this.secondPdf)
    this.resource('test-pdf-scan', 'Documento sin texto', 'pdf', fixturePdf(['']))
    this.resource(this.videoId, 'Vídeo de prueba', 'video', Buffer.alloc(0), 128 * 1024 ** 2)
  }

  addPdf(id: string, title: string, pages: string[], size?: { width: number; height: number }) {
    this.resource(id, title, 'pdf', fixturePdf(pages, size))
  }

  addHtml(id: string, title: string, content: string, topicId = 'b3t1') {
    this.resource(id, title, 'html', Buffer.from(content))
    const file = this.files.get(id)!
    file.name = `${id}.html`
    file.mimeType = 'text/html'
    file.description = JSON.stringify({ schema: 1, title, kind: 'html', source: 'Personal', topicId, tags: ['Apuntes ampliados'] })
  }

  seedPdfAnnotations(resourceId: string, annotations: PdfAnnotation[]) {
    const version = this.files.get(resourceId)?.md5Checksum
    if (!version) throw new Error('Missing PDF fixture')
    const id = `seed-study-${resourceId}`
    const operations = annotations.map((value, index) => ({
      id: `${id}-${index}`, clock: index + 1,
      patch: { kind: 'annotation', resourceId, version, annotationId: value.id, value },
    }))
    const body = Buffer.from(JSON.stringify({ schema: 1, operations }))
    this.files.set(id, {
      id, name: id, mimeType: 'application/json', size: String(body.byteLength), ownedByMe: true,
      headRevisionId: '1', appProperties: { taiHub: 'study', writer: id },
    })
    this.media.set(id, body)
  }

  addVideo(id: string, title: string, format: 'mp4' | 'mkv' = 'mp4') {
    this.resource(id, title, 'video', Buffer.from('Vídeo sintético'))
    const file = this.files.get(id)!
    file.name = `${id}.${format}`
    if (format === 'mkv') file.mimeType = 'video/x-matroska'
  }

  async install(context: BrowserContext, binaryRouteBridge = false) {
    if (binaryRouteBridge) {
      // Playwright's WebKit interceptor omits Blob-backed request bodies.
      // Send the same bytes as an ArrayBuffer so the mock can inspect them.
      await context.addInitScript(() => {
        const originalFetch = window.fetch
        window.fetch = async (input, init) => {
          if (String(input).startsWith('https://www.googleapis.com/upload/') && init?.body instanceof Blob) {
            return originalFetch(input, { ...init, body: await init.body.arrayBuffer() })
          }
          return originalFetch(input, init)
        }
      })
    }
    await context.route('https://accounts.google.com/gsi/client', route => route.fulfill({
      contentType: 'application/javascript',
      body: `window.google = { accounts: { oauth2: { initTokenClient(config) {
        return { requestAccessToken() { queueMicrotask(() => config.callback({
          access_token: "fixture-token", expires_in: 3600, scope: "${driveScope}"
        })) } }
      } } } }`,
    }))
    await context.route('https://accounts.google.com/o/oauth2/v2/auth?**', route => {
      const auth = new URL(route.request().url()).searchParams
      const prompt = auth.get('prompt')
      this.redirectPrompts.push(prompt)
      const target = new URL(auth.get('redirect_uri')!)
      target.hash = new URLSearchParams(prompt === 'none' && this.requireInteractiveLogin
        ? { state: auth.get('state')!, error: 'interaction_required' }
        : {
        state: auth.get('state')!,
        access_token: 'fixture-token',
        token_type: 'Bearer',
        expires_in: '3600',
        scope: driveScope,
      }).toString()
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><script>location.replace(${JSON.stringify(target.href)})</script>`,
      })
    })
    await context.route('https://www.googleapis.com/**', route => this.route(route))
    await context.route(`https://drive.google.com/file/d/${this.videoId}/view`, route => route.fulfill({
      contentType: 'text/html',
      body: '<title>Visor de Drive simulado</title><p>Vista autenticada simulada</p>',
    }))
  }

  rejectNextAuthRequest() { this.rejectToken = true }

  markForReview(id: string, tags: string[]) {
    const file = this.files.get(id)!
    file.description = JSON.stringify({ ...JSON.parse(file.description!), needsReview: true, tags })
  }

  savedStudy() {
    return [...this.files.values()].filter(file => file.appProperties.taiHub === 'study')
      .map(file => this.media.get(file.id)?.toString('utf8') ?? '').join('\n')
  }

  savedIndexes() {
    return [...this.files.values()].filter(file => file.appProperties.taiHub === 'pdfIndex')
  }

  private resource(id: string, title: string, kind: 'pdf' | 'video' | 'html', body: Buffer, size = body.byteLength) {
    const name = kind === 'pdf' ? `${id}.pdf` : `${id}.mp4`
    const file: MockFile = {
      id, name, size: String(size), mimeType: kind === 'pdf' ? 'application/pdf' : 'video/mp4',
      description: JSON.stringify({ schema: 1, title, kind, source: 'Fuente sintética', tags: ['prueba'], topicId: null }),
      md5Checksum: md5(body), headRevisionId: '1', appProperties: { taiHub: 'resource' }, ownedByMe: true,
      webViewLink: `https://drive.google.com/file/d/${id}/view`,
    }
    this.files.set(id, file)
    this.media.set(id, body)
  }

  private async route(route: Route) {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const cors = {
      'access-control-allow-origin': `http://localhost:${process.env.TAI_E2E_PORT ?? 5189}`,
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type,range',
      'access-control-expose-headers': 'accept-ranges,content-length,content-range',
    }
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data, headers: cors })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (request.headers().authorization !== 'Bearer fixture-token') return json({ error: {} }, 401)
    const path = url.pathname.replace(/^\/(?:upload\/)?drive\/v3/, '')
    if (path === '/about') return json({
      user: { permissionId: accountId, displayName: 'Cuenta de prueba', emailAddress: 'cuenta@example.test' },
      storageQuota: { limit: '16106127360', usage: '6000000000' },
    })
    if (path === '/files/generateIds') return json({ ids: [`generated-${this.nextId++}`] })
    if (path === '/files' && method === 'GET') {
      const query = url.searchParams.get('q') ?? ''
      const kind = query.match(/key='taiHub' and value='([^']+)'/)?.[1]
      const importKey = query.match(/key='importKey' and value='([^']+)'/)?.[1]
      if (kind === 'resource' && this.rejectToken) {
        this.rejectToken = false
        return json({ error: {} }, 401)
      }
      return json({ files: [...this.files.values()].filter(file => !file.trashed && file.appProperties.taiHub === kind
        && (!importKey || file.appProperties.importKey === importKey)) })
    }
    const revision = path.match(/^\/files\/([^/]+)\/revisions(?:\/([^/]+))?$/)
    if (revision) {
      const [, fileId, revisionId] = revision
      const original = this.files.get(fileId)
      const bytes = this.media.get(fileId)
      const revisionKey = fileId + '/' + revisionId
      if (method === 'PATCH' && original && bytes && original.headRevisionId === revisionId) {
        this.revisions.set(revisionKey, { id: revisionId, originalFilename: original.name, body: bytes })
        return json({ id: revisionId, keepForever: true })
      }
      const saved = this.revisions.get(revisionKey)
      if (method === 'GET' && saved && url.searchParams.get('alt') === 'media') {
        return route.fulfill({ body: saved.body, contentType: 'application/pdf', headers: cors })
      }
      if (method === 'GET' && saved) return json({ ...saved, body: undefined, keepForever: true })
      if (method === 'GET' && !revisionId) return json({
        revisions: [
          ...(original ? [{ id: original.headRevisionId, originalFilename: original.name, keepForever: true }] : []),
          ...[...this.revisions.entries()].filter(([key]) => key.startsWith(fileId + '/'))
            .map(([, { id, originalFilename }]) => ({ id, originalFilename, keepForever: true })),
        ],
      })
      return json({ error: {} }, 404)
    }
    const id = path.match(/^\/files\/([^/]+)$/)?.[1]
    const current = id ? this.files.get(id) : undefined
    if (url.searchParams.get('uploadType') === 'multipart') {
      const boundary = request.headers()['content-type']?.split('boundary=')[1]
      const buffer = request.postDataBuffer()
      if (!boundary || !buffer) return json({ error: {} }, 400)
      const first = buffer.indexOf('\r\n\r\n') + 4
      const second = buffer.indexOf(`\r\n--${boundary}\r\n`, first)
      const start = buffer.indexOf('\r\n\r\n', second) + 4
      const end = buffer.lastIndexOf(`\r\n--${boundary}--\r\n`)
      const metadata = JSON.parse(buffer.toString('utf8', first, second)) as MockFile
      const body = buffer.subarray(start, end)
      const file = {
        ...current, ...metadata, id: id ?? metadata.id, ownedByMe: true,
        size: String(body.byteLength), md5Checksum: md5(body),
        headRevisionId: String(Number(current?.headRevisionId ?? 0) + 1),
      }
      this.files.set(file.id, file)
      this.media.set(file.id, body)
      return json(file)
    }
    if (method === 'POST' && path === '/files') {
      const file = { ...(request.postDataJSON() as MockFile), ownedByMe: true, size: '0' }
      this.files.set(file.id, file)
      return json(file)
    }
    if (method === 'GET' && url.searchParams.get('alt') === 'media' && current) {
      this.mediaReads.push(current.id)
      if (current.id === this.videoId) return json({ error: {} }, 413)
      const body = this.media.get(current.id) ?? Buffer.alloc(0)
      return route.fulfill({ body, contentType: current.mimeType, headers: { ...cors, 'accept-ranges': 'bytes' } })
    }
    if (method === 'PATCH' && current) {
      const updated = { ...current, ...request.postDataJSON() } as MockFile
      this.files.set(updated.id, updated)
      return json(updated)
    }
    if (method === 'GET' && current) return json(current)
    return json({ error: {} }, 404)
  }
}

function md5(body: Buffer) {
  return createHash('md5').update(body).digest('hex')
}
