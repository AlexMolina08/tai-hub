import { expect, test } from '@playwright/test'
import { DriveFixture } from './fixtures'
import { samplePackage } from '../src/lab/fixtures.test-support'

test('expands the PDF and keeps page, zoom and highlights when leaving reading mode', async ({
  page, context, browserName, isMobile,
}) => {
  await new DriveFixture().install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Buscar en la biblioteca' }).fill('observacion objetivo')
  await page.getByRole('button', { name: /Documento de prueba General · Página 2/ }).click()
  const pageCanvas = page.getByRole('img', { name: 'Página 2 del PDF' })
  await expect(pageCanvas).toBeVisible()
  const scroll = page.getByRole('region', { name: 'Página del PDF' })
  const initialSize = (await scroll.boundingBox())!
  const appHeader = page.locator('.topbar')

  const toggle = page.getByRole('button', { name: 'Modo lectura', exact: true })
  await toggle.click()
  const reader = page.getByRole('dialog', { name: 'Modo lectura PDF' })
  const exit = reader.getByRole('button', { name: 'Salir del modo lectura' })
  await expect(reader).toBeVisible()
  await expect(exit).toBeFocused()
  await expect(appHeader).toHaveAttribute('inert', '')
  const viewport = page.viewportSize()!
  const fullSize = (await scroll.boundingBox())!
  expect(fullSize.width).toBeGreaterThan(initialSize.width)
  expect(fullSize.width).toBeGreaterThan(viewport.width * 0.9)
  expect(fullSize.height).toBeGreaterThan(initialSize.height + 40)
  expect(fullSize.height).toBeGreaterThan(viewport.height * 0.8)

  const highlight = reader.getByRole('button', { name: 'Subrayar texto seleccionado' })
  await highlight.click()
  await expect(reader.getByRole('status').filter({ hasText: 'Selecciona el texto del PDF' })).toBeVisible()
  await reader.getByRole('button', { name: 'Aumentar zoom' }).click()
  await expect(reader.getByRole('button', { name: 'Ajustar al ancho' })).toHaveText('125 %')
  await reader.locator('[data-pdf-page="2"] .textLayer span').first().evaluate(span => {
    const range = document.createRange()
    range.setStart(span.firstChild!, 0)
    range.setEnd(span.firstChild!, 11)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await expect(highlight).toHaveAttribute('data-selected', 'true')
  await highlight.click()
  await expect(reader.locator('.pdf-user-mark').first()).toBeVisible()

  if (isMobile) await exit.click()
  else await page.keyboard.press('Escape')
  await expect(reader).toHaveCount(0)
  await expect(toggle).toBeFocused()
  await expect(appHeader).not.toHaveAttribute('inert', '')
  await expect(pageCanvas).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ajustar al ancho' })).toHaveText('125 %')
  await expect(page.locator('.pdf-user-mark').first()).toBeVisible()
})

test('scrolls through PDF pages continuously and retains the reading position across modes', async ({
  page, context, browserName,
}) => {
  const drive = new DriveFixture()
  const pages = Array.from({ length: 20 }, (_, index) => `Texto de la página ${index + 1}`)
  pages[11] = 'Un salto verificable en un documento largo'
  drive.addPdf('test-continuous', 'Lectura continua de prueba', pages)
  await drive.install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Buscar en la biblioteca' }).fill('salto verificable')
  await page.getByRole('button', { name: /Lectura continua de prueba General · Página 12/ }).click()

  const reader = page.locator('.pdf-reader')
  const scroll = page.getByRole('region', { name: 'Página del PDF' })
  const pageNumber = page.getByRole('textbox', { name: 'Número de página' })
  const slot = (index: number) => reader.locator(`[data-pdf-page="${index}"]`)
  await expect(pageNumber).toHaveValue('12')
  await expect(slot(12).locator('.pdf-search-mark').first()).toBeVisible()
  await expect.poll(async () => Math.abs((await slot(12).boundingBox())!.y - (await scroll.boundingBox())!.y))
    .toBeLessThan(4)

  // Move within the native scroll container, crossing a page boundary without a page command.
  await scroll.evaluate(host => {
    const next = host.querySelector<HTMLElement>('[data-pdf-page="13"]')!
    host.scrollTop = next.offsetTop - 80
  })
  await expect(slot(13).getByRole('img')).toBeVisible()
  const region = (await scroll.boundingBox())!
  const first = (await slot(12).boundingBox())!
  const second = (await slot(13).boundingBox())!
  expect(first.y + first.height).toBeGreaterThan(region.y)
  expect(second.y).toBeLessThan(region.y + region.height)
  await expect(pageNumber).toHaveValue('12')

  // A selection belongs to the page its text is on, even with another page at the top.
  await slot(13).locator('.textLayer span').first().evaluate(span => {
    const selection = window.getSelection()!
    const range = document.createRange()
    range.setStart(span.firstChild!, 0)
    range.setEnd(span.firstChild!, 5)
    selection.removeAllRanges()
    selection.addRange(range)
  })
  const highlight = page.getByRole('button', { name: 'Subrayar texto seleccionado' })
  await expect(highlight).toHaveAttribute('data-selected', 'true')
  await highlight.click()
  await expect(slot(13).locator('.pdf-user-mark').first()).toBeVisible()
  await expect(slot(12).locator('.pdf-user-mark')).toHaveCount(0)

  await scroll.evaluate(host => {
    const target = host.querySelector<HTMLElement>('[data-pdf-page="13"]')!
    host.scrollTop = target.offsetTop + target.clientHeight / 4
  })
  await expect(pageNumber).toHaveValue('13')
  await page.getByRole('button', { name: 'Marcar página', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Quitar marcador' })).toBeVisible()

  const fraction = () => scroll.evaluate(host => {
    const target = host.querySelector<HTMLElement>('[data-pdf-page="13"]')!
    return (host.scrollTop - target.offsetTop) / target.clientHeight
  })
  await page.getByRole('button', { name: 'Modo lectura', exact: true }).click()
  const focused = page.getByRole('dialog', { name: 'Modo lectura PDF' })
  await expect(focused).toBeVisible()
  await expect(pageNumber).toHaveValue('13')
  await expect.poll(async () => Math.abs(await fraction() - 0.25)).toBeLessThan(0.025)
  await focused.getByRole('button', { name: 'Aumentar zoom' }).click()
  await expect.poll(async () => Math.abs(await fraction() - 0.25)).toBeLessThan(0.025)
  await focused.getByRole('button', { name: 'Salir del modo lectura' }).click()
  await expect(pageNumber).toHaveValue('13')
  await expect(page.getByRole('button', { name: 'Ajustar al ancho' })).toHaveText('125 %')
  await expect.poll(async () => Math.abs(await fraction() - 0.25)).toBeLessThan(0.025)

  await pageNumber.fill('20')
  await page.getByRole('button', { name: 'Ir a la página' }).click()
  await expect(pageNumber).toHaveValue('20')
  await expect(slot(20).getByRole('img')).toBeVisible()
  await expect.poll(async () => Math.abs((await slot(20).boundingBox())!.y - (await scroll.boundingBox())!.y))
    .toBeLessThan(4)
  await expect(slot(12).getByRole('img')).toHaveCount(0)
  expect(await reader.locator('canvas').count()).toBeLessThanOrEqual(6)
})

test('renders all visible pages when zoomed out on a landscape PDF', async ({ page, context, browserName }) => {
  const drive = new DriveFixture()
  drive.addPdf('test-landscape', 'Presentación apaisada', Array.from({ length: 30 }, () => 'Texto de prueba'),
    { width: 800, height: 72 })
  await drive.install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Buscar en la biblioteca' }).fill('Presentación apaisada')
  await page.getByRole('button', { name: /Presentación apaisada General/ }).click()
  await page.getByRole('button', { name: 'Modo lectura', exact: true }).click()
  const focused = page.getByRole('dialog', { name: 'Modo lectura PDF' })
  await focused.getByRole('button', { name: 'Reducir zoom' }).click()
  const scroll = focused.getByRole('region', { name: 'Página del PDF' })
  await expect.poll(() => scroll.evaluate(host => {
    const first = host.querySelector<HTMLElement>('[data-pdf-page="1"]')!
    if (!first) return false
    const visiblePages = Math.ceil(host.clientHeight / (first.clientHeight + 12))
    if (visiblePages <= 6) return false
    for (let page = 1; page <= visiblePages; page++) {
      if (!host.querySelector(`[data-pdf-page="${page}"] .pdf-sheet[aria-busy="false"] canvas`)) return false
    }
    return true
  })).toBe(true)
})

test('shows download progress and recovery in reading mode', async ({ page, context, browserName }) => {
  await new DriveFixture().install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Buscar en la biblioteca' }).fill('Documento de prueba')
  await page.getByRole('button', { name: /^Documento de prueba General/ }).click()
  await page.getByRole('button', { name: 'Modo lectura', exact: true }).click()
  const reader = page.getByRole('dialog', { name: 'Modo lectura PDF' })
  await expect(reader.getByRole('img', { name: 'Página 1 del PDF' })).toBeVisible()

  let fail = true
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await context.route('https://www.googleapis.com/drive/v3/files/test-pdf-one?alt=media', async route => {
    if (!fail || route.request().method() !== 'GET') return route.fallback()
    fail = false
    await pending
    return route.fulfill({ status: 403, json: { error: {} }, headers: {
      'access-control-allow-origin': new URL(page.url()).origin,
    } })
  })
  const download = reader.getByRole('button', { name: 'Descargar original' })
  try {
    await download.click()
    await expect(reader.getByText('Preparando descarga…')).toBeVisible()
    await expect(download).toBeDisabled()
  } finally { release() }
  await expect(reader.getByRole('alert')).toHaveText('Google Drive no ha autorizado esta operación.')
  await expect(download).toBeEnabled()
  const finished = page.waitForEvent('download')
  await download.click()
  expect((await finished).suggestedFilename()).toBe('test-pdf-one.pdf')
  await expect(reader.getByRole('alert')).toHaveCount(0)
})

test('keeps the PDF and page jump usable at 320 px in the library', async ({ page, context, browserName }) => {
  await page.setViewportSize({ width: 320, height: 660 })
  await new DriveFixture().install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Buscar en la biblioteca' }).fill('Documento de prueba')
  await page.getByRole('button', { name: /^Documento de prueba General/ }).click()
  const scroll = page.getByRole('region', { name: 'Página del PDF' })
  await expect(scroll.getByRole('img', { name: 'Página 1 del PDF' })).toBeVisible()
  await expect(page.locator('.topbar')).toBeHidden()
  let bounds = (await scroll.boundingBox())!
  expect(bounds.height).toBeGreaterThan(660 * 0.64)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(660)
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(page.locator('.topbar')).toBeHidden()
    bounds = (await scroll.boundingBox())!
    expect(bounds.height).toBeGreaterThan(220)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(390)
    await page.setViewportSize({ width: 320, height: 660 })
  }

  await page.getByRole('button', { name: 'Modo lectura', exact: true }).click()
  const reader = page.getByRole('dialog', { name: 'Modo lectura PDF' })
  const toolbar = reader.locator('.pdf-toolbar')
  const input = reader.getByRole('textbox', { name: 'Número de página' })
  await input.fill('2')
  expect(await toolbar.evaluate(bar => bar.scrollWidth <= bar.clientWidth)).toBe(true)
  await expect(reader.getByRole('button', { name: 'Aumentar zoom' })).toBeInViewport({ ratio: 1 })
  await reader.getByRole('button', { name: 'Ir a la página' }).click()
  await expect(input).toHaveValue('2')
  await expect(scroll).toBeFocused()
  await expect(scroll.getByRole('img', { name: 'Página 2 del PDF' })).toBeVisible()
  await reader.getByRole('button', { name: 'Salir del modo lectura' }).click()
  await expect(page.getByRole('textbox', { name: 'Número de página' })).toHaveValue('2')
})

test('opens the exact PDF page from a lesson in a single scroller and returns to the lesson', async ({ page, context, browserName }) => {
  await page.setViewportSize({ width: 390, height: 740 })
  const pack = samplePackage()
  pack.lessons[0].material = { resourceId: 'test-pdf-one', sectionId: 'pdf-page:2' }
  const drive = new DriveFixture()
  drive.addLabPackage('test-pdf-material', pack)
  await drive.install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await page.getByRole('button', { name: 'Abrir Laboratorio TAI' }).click()
  await page.getByRole('button', { name: 'Cargar lecciones de Drive' }).click()
  await page.getByRole('button', { name: /Lección sintética/ }).click()
  const material = page.getByRole('button', { name: 'Consultar material completo' })
  await material.click()
  const dialog = page.getByRole('dialog', { name: 'Documento de prueba', exact: true })
  const scroll = dialog.getByRole('region', { name: 'Página del PDF' })
  await expect(scroll.getByRole('img', { name: 'Página 2 del PDF' })).toBeInViewport()
  expect(await dialog.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true)
  const exit = dialog.getByRole('button', { name: 'Volver al estudio' })
  await expect(exit).toBeInViewport({ ratio: 1 })

  const enterReading = dialog.getByRole('button', { name: 'Modo lectura', exact: true })
  await enterReading.click()
  const reader = page.getByRole('dialog', { name: 'Modo lectura PDF' })
  await expect(reader.getByRole('img', { name: 'Página 2 del PDF' })).toBeInViewport()
  await page.keyboard.press('Escape')
  await expect(enterReading).toBeFocused()
  await expect(dialog).toBeVisible()
  await exit.click()
  await expect(material).toBeFocused()
})
