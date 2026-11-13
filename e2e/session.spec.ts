import { expect, test, type Page } from '@playwright/test'
import { DriveFixture } from './fixtures'

const home = '/tai-hub/'
const connectButton = (page: Page) => page.getByRole('button', { name: 'Conectar Google Drive', exact: true })
const library = (page: Page) => page.getByRole('region', { name: 'Continuar estudio' })

test('resumes the library after reload without storing access tokens', async ({ page, context, browserName }) => {
  const drive = new DriveFixture()
  await drive.install(context)
  await page.goto(home)
  await connectButton(page).click()
  await expect(library(page)).toBeVisible()

  await page.reload()
  await expect(library(page)).toBeVisible()
  if (browserName === 'webkit') {
    await expect(page.getByRole('button', { name: 'Reconectar', exact: true })).toBeEnabled()
    expect(drive.redirectPrompts).toEqual(['select_account'])
    return
  }
  expect(drive.redirectPrompts.at(-1)).toBe('none')

  const tab = await context.newPage()
  await tab.goto(home)
  await expect(library(tab)).toBeVisible()
  expect(drive.redirectPrompts.filter(prompt => prompt === 'none')).toHaveLength(2)
  const leaks = await tab.evaluate(() => [location.href, ...Object.values(localStorage), ...Object.values(sessionStorage)]
    .some(value => value.includes('fixture-token')))
  expect(leaks).toBe(false)

  await page.getByRole('button', { name: 'Cuenta y ajustes' }).click()
  await page.getByRole('button', { name: 'Desconectar', exact: true }).click()
  await expect(connectButton(tab)).toBeVisible()
  await tab.reload()
  await expect(connectButton(tab)).toBeVisible()
  expect(drive.redirectPrompts.filter(prompt => prompt === 'none')).toHaveLength(2)
})

test('shows a single reconnect action when Google requires interaction', async ({ page, context, browserName }) => {
  const drive = new DriveFixture()
  await drive.install(context)
  await page.goto(home)
  await connectButton(page).click()
  await expect(library(page)).toBeVisible()

  drive.requireInteractiveLogin = true
  if (browserName === 'webkit') {
    await page.reload()
    const reconnect = page.getByRole('button', { name: 'Reconectar', exact: true })
    await expect(reconnect).toBeEnabled()
    await page.reload()
    await expect(reconnect).toBeEnabled()
    expect(drive.redirectPrompts).toEqual(['select_account'])
    await reconnect.click()
    await expect(page.getByRole('button', { name: 'Añadir recurso', exact: true })).toBeEnabled()
    return
  }
  await page.reload()
  const reconnect = page.getByRole('button', { name: 'Reconectar', exact: true })
  await expect(reconnect).toBeEnabled()
  expect(drive.redirectPrompts.filter(prompt => prompt === 'none')).toHaveLength(1)
  await page.reload()
  await expect(reconnect).toBeEnabled()
  expect(drive.redirectPrompts.filter(prompt => prompt === 'none')).toHaveLength(1)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await reconnect.click()
  await expect(library(page)).toBeVisible()
})

test('searches the saved PDF index on return without loading the PDF extractor', async ({ page, context, browserName }) => {
  const drive = new DriveFixture()
  await drive.install(context, browserName === 'webkit')
  await page.goto(home)
  await connectButton(page).click()
  await expect(library(page)).toBeVisible()
  async function expectReadyIndex() {
    await page.getByRole('button', { name: 'Cuenta y ajustes' }).click()
    const settings = page.getByRole('dialog')
    await expect(settings.getByText('2 PDF indexados · 1 sin texto extraíble · 0 pendientes')).toBeVisible()
    await expect(settings.getByText('El índice se guarda en este navegador y en tu Drive.')).toBeVisible()
    await settings.getByRole('button', { name: 'Cerrar', exact: true }).click()
  }
  await expectReadyIndex()
  await expect.poll(() => drive.savedIndexes()).toHaveLength(3)

  let extractorRequests = 0
  await page.route('**/assets/document-*.js', route => {
    extractorRequests++
    return route.abort()
  })
  await page.reload()
  await expect(library(page)).toBeVisible()
  if (browserName === 'webkit') {
    await page.getByRole('button', { name: 'Reconectar', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Añadir recurso', exact: true })).toBeEnabled()
  }
  await expectReadyIndex()
  await page.getByRole('textbox', { name: 'Buscar en la biblioteca' }).fill('observacion objetivo')
  await expect(page.getByRole('button', { name: /Documento de prueba General · Página 2/ })).toBeVisible()
  expect(extractorRequests).toBe(0)
})

test('leaves an open PDF readable after expiry and returns to the same page after reconnecting', async ({ page, context, browserName }) => {
  const drive = new DriveFixture()
  await drive.install(context, browserName === 'webkit')
  await page.goto(home)
  await connectButton(page).click()
  await expect(library(page)).toBeVisible()
  const search = page.getByRole('textbox', { name: 'Buscar en la biblioteca' })
  await search.fill('observacion objetivo')
  await page.getByRole('button', { name: /Documento de prueba General · Página 2/ }).click()
  const pdfPage = page.getByRole('img', { name: 'Página 2 del PDF' })
  await expect(pdfPage).toBeVisible()

  drive.rejectNextAuthRequest()
  await page.getByRole('button', { name: 'Cuenta y ajustes' }).click()
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
  await expect(page.getByText(/Acceso caducado/)).toBeVisible()
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await expect(pdfPage).toBeVisible()
  await page.getByRole('button', { name: 'Reconectar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Opciones', exact: false })).toBeEnabled()
  await expect(pdfPage).toBeVisible()
  await page.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect(search).toHaveValue('observacion objetivo')
  await expect(page.getByRole('button', { name: /Documento de prueba General · Página 2/ })).toBeVisible()
})

test('macOS Safari can study from cache on reopen and reconnects in the same tab', async ({ browser, browserName, baseURL }) => {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
    viewport: { width: 1366, height: 900 },
    isMobile: false,
    hasTouch: false,
  })
  try {
    const drive = new DriveFixture()
    await drive.install(context, browserName === 'webkit')
    const page = await context.newPage()
    await page.goto(baseURL! + home)
    await connectButton(page).click()
    await expect(library(page)).toBeVisible()
    await page.getByRole('button', { name: 'Laboratorio TAI', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Laboratorio TAI', exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Laboratorio TAI', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reconectar', exact: true })).toBeEnabled()
    expect(drive.redirectPrompts).toEqual(['select_account'])
    await page.getByRole('button', { name: 'Reconectar', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Laboratorio TAI', exact: true })).toBeVisible()
    await expect(page.getByText('Drive conectado', { exact: true })).toBeVisible()
    expect(drive.redirectPrompts).toEqual(['select_account', null])
    expect(context.pages()).toHaveLength(1)
  } finally {
    await context.close()
  }
})

test('preserves the catalogue and a verified session when the Drive listing fails', async ({ page, context, browserName }) => {
  const drive = new DriveFixture()
  await drive.install(context)
  await context.addInitScript(() => {
    const open = IDBFactory.prototype.open
    const success = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!
    IDBFactory.prototype.open = function (name, version) {
      const request = open.call(this, name, version)
      if (name !== 'tai-hub-library-v1' || sessionStorage.getItem('catalogue-cache-opened')) return request
      sessionStorage.setItem('catalogue-cache-opened', 'true')
      // Pause the real database before its first write transaction can start.
      Object.defineProperty(request, 'onsuccess', {
        set(handler: (event: Event) => void) {
          success.set!.call(request, (event: Event) => {
            document.documentElement.dataset.catalogueCachePending = 'true'
            document.addEventListener('test-catalogue-cache-release', () => handler.call(request, event), { once: true })
          })
        },
      })
      return request
    }
  })
  await page.goto(home)
  await connectButton(page).click()
  await expect(page.locator('html')).toHaveAttribute('data-catalogue-cache-pending', 'true')
  await expect(page.getByRole('heading', { name: '4 recursos', exact: true })).toHaveCount(0)
  await page.evaluate(() => document.dispatchEvent(new Event('test-catalogue-cache-release')))
  await expect(library(page)).toContainText('4 recursos')
  let allowListing = false
  await context.route('https://www.googleapis.com/drive/v3/files?**', route => {
    const query = new URL(route.request().url()).searchParams.get('q')
    return !allowListing && query?.includes("value='resource'")
      ? route.fulfill({ status: 503, json: { error: { message: 'Fixture unavailable' } } })
      : route.fallback()
  })
  await page.reload()
  await expect(library(page)).toContainText('4 recursos')
  if (browserName === 'webkit') await page.getByRole('button', { name: 'Reconectar', exact: true }).click()
  await expect(page.getByText('No se pudo actualizar la biblioteca desde Drive.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Añadir recurso', exact: true })).toBeEnabled()
  await expect(library(page)).toContainText('4 recursos')
  allowListing = true
  await expect(page.getByText('No se pudo actualizar la biblioteca desde Drive.')).toHaveCount(0)
})
