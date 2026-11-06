import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { blocks } from '../src/syllabus'
import { DriveFixture, fixturePdf } from './fixtures'

const home = '/tai-hub/'
const sampleNote = 'Nota de verificación de una segunda sesión'

async function connect(page: Page) {
  await page.goto(home)
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
}

test('navigates every official topic and switches appearance while signed out', async ({ page, context }) => {
  await new DriveFixture().install(context)
  await page.goto(home)
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { name: 'Biblioteca de estudio' })).toBeVisible()
  expect(blocks).toHaveLength(4)
  expect(blocks.flatMap(block => [...block.topics])).toHaveLength(33)
  for (const block of blocks) {
    await main.getByRole('button', { name: new RegExp(block.title) }).click()
    await expect(main.getByRole('heading', { name: block.title, exact: true })).toBeVisible()
    for (const topic of block.topics) {
      await main.getByRole('button', { name: new RegExp(topic.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
      await expect(main.getByRole('heading', { name: topic.title, exact: true })).toBeVisible()
      await main.getByRole('button', { name: `Bloque ${block.roman}`, exact: true }).click()
    }
    await page.getByRole('button', { name: 'Inicio', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Cuenta y ajustes' }).click()
  await page.getByRole('button', { name: 'Oscuro', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const drawer = page.getByRole('button', { name: 'Abrir navegación' })
  if (await drawer.isVisible()) {
    await drawer.click()
    await expect(drawer).toHaveAttribute('aria-expanded', 'true')
    const scrim = page.getByRole('button', { name: 'Cerrar navegación' })
    const area = (await scrim.boundingBox())!
    await scrim.click({ position: { x: area.width - 7, y: Math.round(area.height / 2) } })
    await expect(drawer).toHaveAttribute('aria-expanded', 'false')
  }
})

test('opens exact PDF results, downloads original and syncs notes to an independent session', async ({ page, context, browser, browserName }) => {
  const drive = new DriveFixture()
  await drive.install(context, browserName === 'webkit')
  await connect(page)
  const search = page.getByRole('textbox', { name: 'Buscar en la biblioteca' })
  await search.fill('observacion objetivo')
  const first = page.getByRole('button', { name: /Documento de prueba General · Página 2/ })
  const second = page.getByRole('button', { name: /Segundo documento General · Página 1/ })
  await expect(second).toBeVisible()
  await expect(first.locator('mark')).toHaveText(['Observación', 'objetivo'])
  await expect.poll(() => drive.savedIndexes()).toHaveLength(3)
  await first.click()
  await expect(page.getByRole('img', { name: 'Página 2 del PDF' })).toBeVisible()
  await expect(page.locator('.pdf-search-mark').first()).toBeVisible()
  await page.getByRole('button', { name: 'Marcar página' }).click()
  await page.getByRole('button', { name: 'Notas, marcadores y subrayados' }).click()
  await page.getByRole('textbox', { name: 'Nota de la página 2' }).fill(sampleNote)
  await page.getByRole('button', { name: 'Guardar nota' }).click()
  await expect.poll(() => drive.savedStudy()).toContain(sampleNote)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar original' }).click()
  const downloaded = await downloadEvent
  expect(downloaded.suggestedFilename()).toBe('test-pdf-one.pdf')
  expect(await readFile((await downloaded.path())!)).toEqual(drive.firstPdf)

  const other = await browser.newContext()
  try {
    await drive.install(other, browserName === 'webkit')
    const tab = await other.newPage()
    await connect(tab)
    await tab.getByRole('button', { name: 'Abrir último recurso' }).click()
    await expect(tab.getByRole('img', { name: 'Página 2 del PDF' })).toBeVisible()
    await expect(tab.getByRole('button', { name: 'Quitar marcador' })).toBeVisible()
    await tab.getByRole('button', { name: 'Notas, marcadores y subrayados' }).click()
    await expect(tab.getByRole('button', { name: new RegExp(sampleNote) })).toBeVisible()
  } finally {
    await other.close()
  }
})

test('opens large video in Drive without fetching bytes and recovers an expired session', async ({ page, context, browserName }) => {
  const drive = new DriveFixture()
  await drive.install(context, browserName === 'webkit')
  await connect(page)
  await page.getByRole('textbox', { name: 'Buscar en la biblioteca' }).fill('Vídeo de prueba')
  await page.getByRole('button', { name: /Vídeo de prueba General/ }).click()
  const viewer = page.getByRole('link', { name: 'Reproducir en Drive' })
  await expect(page.getByRole('button', { name: 'Descargar original' })).toHaveCount(0)
  await expect(viewer).toHaveAttribute('href', 'https://drive.google.com/file/d/test-video/view')
  const popup = page.waitForEvent('popup')
  await viewer.click()
  const opened = await popup
  await expect(opened.getByText('Vista autenticada simulada')).toBeVisible()
  await opened.close()
  expect(drive.mediaReads).not.toContain(drive.videoId)

  await context.setOffline(true)
  await expect(page.getByText(/Sin conexión/).first()).toBeVisible()
  await context.setOffline(false)
  drive.rejectNextAuthRequest()
  await page.getByRole('button', { name: 'Cuenta y ajustes' }).click()
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
  await expect(page.getByText('Acceso caducado', { exact: false }).first()).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Conectar Drive', exact: true }).click()
  if (browserName === 'webkit') await expect(viewer).toBeVisible()
  else await expect(page.getByRole('dialog').getByText(/Cuenta de prueba · Conectado/)).toBeVisible()
})

test('replaces and reindexes a PDF while retaining its previous original', async ({ page, context, browserName }) => {
  const drive = new DriveFixture()
  await drive.install(context, browserName === 'webkit')
  await connect(page)
  const search = page.getByRole('textbox', { name: 'Buscar en la biblioteca' })
  await search.fill('observacion objetivo')
  await expect.poll(() => drive.savedIndexes()).toHaveLength(3)
  await page.getByRole('button', { name: /Documento de prueba General · Página 2/ }).click()
  await page.getByRole('button', { name: 'Opciones', exact: true }).click()
  await page.getByRole('button', { name: 'Editar ficha', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Editar recurso' })
  await form.getByLabel('Elegir nueva versión').setInputFiles({
    name: 'version-nueva.pdf', mimeType: 'application/pdf', buffer: fixturePdf(['Contenido sustituto verificable']),
  })
  await form.getByLabel('Título').fill('Documento actualizado')
  await form.getByLabel('Ubicación').selectOption('b1t1')
  await form.getByLabel('Etiquetas').fill('prueba, versión')
  // A revision and its description must be committed by the same upload.
  await page.route(/https:\/\/www\.googleapis\.com\/drive\/v3\/files\/test-pdf-one\?/, route =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 503, json: {} }) : route.fallback())
  await form.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(form).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'Documento actualizado' })).toBeVisible()
  await page.getByRole('button', { name: 'Opciones', exact: true }).click()
  await page.getByRole('button', { name: 'Versiones', exact: true }).click()
  const versions = page.getByRole('dialog', { name: 'Versiones del original' })
  await expect(versions.getByRole('button', { name: 'Descargar' })).toHaveCount(1)
  const oldEvent = page.waitForEvent('download')
  await versions.getByRole('button', { name: 'Descargar' }).click()
  const oldDownload = await oldEvent
  expect(await readFile((await oldDownload.path())!)).toEqual(drive.firstPdf)
  await page.keyboard.press('Escape')
  await search.fill('sustituto verificable')
  await expect(page.getByRole('button', { name: /Documento actualizado.*Página 1/ })).toBeVisible()
  await search.fill('observacion objetivo')
  await expect(page.getByRole('button', { name: /Segundo documento General · Página 1/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Documento actualizado.*Página 2/ })).toHaveCount(0)
})

test('identifies a text original with a generic MIME and retries its preview', async ({ page, context, browserName }) => {
  const drive = new DriveFixture()
  await drive.install(context, browserName === 'webkit')
  await connect(page)
  await expect.poll(() => drive.savedIndexes()).toHaveLength(3)
  await page.getByRole('button', { name: 'Añadir recurso', exact: true }).first().click()
  const form = page.getByRole('dialog', { name: 'Añadir recurso' })
  await form.getByLabel('Seleccionar archivo').setInputFiles({
    name: 'Apunte sintético.txt', mimeType: 'application/octet-stream', buffer: Buffer.from('Texto de prueba para vista previa.'),
  })
  const save = page.waitForResponse(response => response.url().includes('/upload/drive/v3/files?uploadType=multipart'))
  await form.getByRole('button', { name: 'Añadir recurso' }).click()
  const { id } = await (await save).json()
  await expect(form).not.toBeVisible()
  let first = true
  await page.route(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, route => {
    if (!first) return route.fallback()
    first = false
    return route.fulfill({ status: 503, json: {} })
  })
  await page.getByRole('textbox', { name: 'Buscar en la biblioteca' }).fill('Apunte sintético')
  await page.getByRole('button', { name: /Apunte sintético General/ }).click()
  await expect(page.getByText(/Personal · Texto/)).toBeVisible()
  await page.getByRole('button', { name: 'Reintentar vista previa' }).click()
  await expect(page.getByText('Texto de prueba para vista previa.')).toBeVisible()
})

test('imports a manifest, verifies bytes and skips a completed import on retry', async ({ page, context, browserName }) => {
  const drive = new DriveFixture()
  await drive.install(context, browserName === 'webkit')
  await connect(page)
  const directory = await mkdtemp(join(tmpdir(), 'tai-hub-fixture-'))
  try {
    const name = 'práctica.txt'
    const body = Buffer.from('Material sintético para verificar la incorporación.')
    await writeFile(join(directory, name.normalize('NFD')), body)
    const manifest = { version: 1, resources: [{
      key: createHash('sha256').update(body).digest('hex'),
      md5: createHash('md5').update(body).digest('hex'),
      path: name, title: 'Práctica importada', source: 'Fuente sintética', topicId: 'b1t1',
      relatedTopicIds: ['b1t2'], tags: ['prueba'], mimeType: 'text/plain', size: body.length,
    }] }
    await page.getByRole('button', { name: 'Cuenta y ajustes' }).click()
    await page.getByRole('button', { name: 'Importar carpeta' }).click()
    const panel = page.getByRole('dialog', { name: 'Importar biblioteca' })
    await panel.getByLabel('Manifiesto').setInputFiles({
      name: 'manifest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)),
    })
    const confirm = panel.getByRole('button', { name: 'Confirmar subida privada' })
    await expect(confirm).toBeDisabled()
    await panel.getByLabel('Carpeta de originales').setInputFiles(directory)
    await confirm.click()
    await expect(panel.getByRole('status')).toContainText('1 incorporados')
    await confirm.click()
    await expect(panel.getByRole('status')).toContainText('0 incorporados')
    await panel.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await page.getByRole('textbox', { name: 'Buscar en la biblioteca' }).fill('Práctica importada')
    await expect(page.getByRole('button', { name: /Práctica importada I.1/ })).toHaveCount(1)
  } finally {
    await rm(directory, { recursive: true })
  }
})
