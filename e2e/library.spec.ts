import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { blocks } from '../src/syllabus'
import { DriveFixture, fixturePdf } from './fixtures'

const home = '/tai-hub/'
const sampleNote = 'Nota de verificación de una segunda sesión'

async function connect(page: Page) {
  await page.goto(home)
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Tu próxima sesión' })).toBeVisible()
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
  await first.click()
  await expect(page.getByRole('img', { name: 'Página 2 del PDF' })).toBeVisible()
  await expect(page.locator('.pdf-search-mark').first()).toBeVisible()
  await page.getByRole('button', { name: 'Marcar página' }).click()
  await page.getByRole('button', { name: 'Notas, marcadores y subrayados' }).click()
  await page.getByRole('textbox', { name: 'Nota de la página 2' }).fill(sampleNote)
  await page.getByRole('button', { name: 'Guardar nota' }).click()
  await expect.poll(() => drive.savedStudy()).toContain(sampleNote)
  await expect.poll(() => drive.savedIndexes()).toHaveLength(3)
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
    await tab.getByRole('button', { name: 'Continuar lectura' }).click()
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
  await expect(page.getByRole('dialog').getByText(/Cuenta de prueba · Conectado/)).toBeVisible()
})

test('replaces and reindexes a PDF while retaining its previous original', async ({ page, context, browserName }) => {
  const drive = new DriveFixture()
  await drive.install(context, browserName === 'webkit')
  await connect(page)
  const search = page.getByRole('textbox', { name: 'Buscar en la biblioteca' })
  await search.fill('observacion objetivo')
  await page.getByRole('button', { name: /Documento de prueba General · Página 2/ }).click()
  await expect.poll(() => drive.savedIndexes()).toHaveLength(3)
  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Editar recurso' })
  await form.getByLabel('Elegir nueva versión').setInputFiles({
    name: 'version-nueva.pdf', mimeType: 'application/pdf', buffer: fixturePdf(['Contenido sustituto verificable']),
  })
  await form.getByLabel('Título').fill('Documento actualizado')
  await form.getByLabel('Ubicación').selectOption('b1t1')
  await form.getByLabel('Etiquetas').fill('prueba, versión')
  await form.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(form).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'Documento actualizado' })).toBeVisible()
  await page.getByRole('button', { name: 'Versiones', exact: true }).click()
  const versions = page.getByRole('dialog', { name: 'Versiones del original' })
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
