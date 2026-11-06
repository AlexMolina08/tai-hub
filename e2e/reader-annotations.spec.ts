import { expect, test, type Page } from '@playwright/test'
import { DriveFixture } from './fixtures'

async function openPdf(page: Page) {
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Buscar en la biblioteca' }).fill('Documento de prueba')
  await page.getByRole('button', { name: /^Documento de prueba General/ }).click()
  const reader = page.locator('.pdf-reader')
  await expect(reader.locator('[data-pdf-page="1"] .textLayer span').first()).toBeVisible()
  return reader
}

async function selectText(page: Page, start = 0, end = 6) {
  await page.locator('[data-pdf-page="1"] .textLayer span').first().evaluate((span, { start, end }) => {
    const range = document.createRange()
    range.setStart(span.firstChild!, start)
    range.setEnd(span.firstChild!, end)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  }, { start, end })
  await expect(page.getByRole('button', { name: 'Subrayar texto seleccionado' })).toHaveAttribute('data-selected', 'true')
}

test('keeps repeated and partly overlapping selections from stacking highlights', async ({ page, context, browserName, isMobile }) => {
  await new DriveFixture().install(context, browserName === 'webkit')
  const reader = await openPdf(page)
  const highlight = reader.getByRole('button', { name: 'Subrayar texto seleccionado' })
  const marks = reader.locator('.pdf-user-mark')
  const pressHighlight = () => isMobile ? highlight.tap() : highlight.click()
  await selectText(page)
  await pressHighlight()
  await expect(marks).toHaveCount(1)

  await reader.getByRole('button', { name: 'Aumentar zoom' }).click()
  await expect(reader.getByRole('button', { name: 'Ajustar al ancho' })).toHaveText('125 %')
  await selectText(page)
  await pressHighlight()
  await expect(marks).toHaveCount(1)
  await expect(reader.getByRole('status').filter({ hasText: 'El texto ya está subrayado' })).toBeVisible()
  await page.keyboard.press('Meta+z')
  await expect(marks).toHaveCount(0)
  await page.keyboard.press('Meta+Shift+z')
  await expect(marks).toHaveCount(1)

  await selectText(page, 4, 9)
  await pressHighlight()
  await expect(marks).toHaveCount(2)
  const first = (await marks.nth(0).boundingBox())!
  const extension = (await marks.nth(1).boundingBox())!
  expect(extension.x).toBeGreaterThanOrEqual(first.x + first.width - 0.1)
  expect(extension.width).toBeGreaterThan(2)
  if (!isMobile) {
    await page.mouse.move(first.x + 2, first.y + first.height / 2)
    await page.mouse.down()
    await page.mouse.move(extension.x + extension.width / 2, extension.y + extension.height / 2, { steps: 4 })
    await page.mouse.up()
    await expect(marks).toHaveCount(2)
  }
})

test('Command+Z undoes the highlight just created and cut leaves it intact', async ({ page, context, browserName }) => {
  await new DriveFixture().install(context, browserName === 'webkit')
  const reader = await openPdf(page)
  await selectText(page)
  await reader.getByRole('button', { name: 'Subrayar texto seleccionado' }).click()
  const mark = reader.locator('.pdf-user-mark')
  await expect(mark).toHaveCount(1)
  await expect(reader.getByRole('button', { name: 'Deshacer', exact: true })).toBeInViewport()
  await page.keyboard.press('Control+x')
  await expect(mark).toHaveCount(1)
  await page.keyboard.press('Meta+z')
  await expect(mark).toHaveCount(0)
})

test('clears a cancelled selection and keeps keyboard shortcuts local to the reader', async ({ page, context, browserName }) => {
  await new DriveFixture().install(context, browserName === 'webkit')
  const reader = await openPdf(page)
  const highlight = reader.getByRole('button', { name: 'Subrayar texto seleccionado' })
  await selectText(page)
  await reader.locator('[data-pdf-page="1"] .pdf-sheet').click({ position: { x: 120, y: 160 } })
  await expect(highlight).toHaveAttribute('data-selected', 'false')
  await highlight.click()
  await expect(reader.locator('.pdf-user-mark')).toHaveCount(0)

  await selectText(page)
  await highlight.click()
  await expect(reader.locator('.pdf-user-mark')).toHaveCount(1)
  await reader.getByRole('button', { name: 'Notas, marcadores y subrayados' }).click()
  const note = reader.getByRole('textbox', { name: 'Nota de la página 1' })
  await note.pressSequentially('Borrador')
  await note.selectText()
  await expect(note).toBeFocused()
  await note.press(process.platform === 'darwin' ? 'Meta+x' : 'Control+x')
  await expect(note).toHaveValue('')
  await note.evaluate(field => field.addEventListener('keydown', event => {
    setTimeout(() => { field.dataset.undoPrevented = String(event.defaultPrevented) }, 0)
  }, { once: true }))
  await note.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect(note).toHaveAttribute('data-undo-prevented', 'false')
  await expect(reader.locator('.pdf-user-mark')).toHaveCount(1)
  await reader.getByRole('region', { name: 'Página del PDF' }).focus()
  await page.keyboard.press('Meta+z')
  await expect(reader.locator('.pdf-user-mark')).toHaveCount(0)
  await page.keyboard.press('Meta+Shift+z')
  await expect(reader.locator('.pdf-user-mark')).toHaveCount(1)
})

test('does not turn a collapsed native selection into a highlight', async ({ page, context, browserName }) => {
  await new DriveFixture().install(context, browserName === 'webkit')
  const reader = await openPdf(page)
  await selectText(page)
  await page.evaluate(() => window.getSelection()?.collapseToEnd())
  const highlight = reader.getByRole('button', { name: 'Subrayar texto seleccionado' })
  await expect(highlight).toHaveAttribute('data-selected', 'false')
  await highlight.click()
  await expect(reader.locator('.pdf-user-mark')).toHaveCount(0)
})

test('removes a saved highlight from the page and synchronizes its restoration', async ({ page, context, browser, browserName, isMobile }) => {
  const drive = new DriveFixture()
  await drive.install(context, browserName === 'webkit')
  const reader = await openPdf(page)
  await selectText(page)
  await reader.getByRole('button', { name: 'Subrayar texto seleccionado' }).click()
  await expect.poll(() => drive.savedStudy()).toContain('"kind":"highlight"')

  const second = await browser.newContext(isMobile ? {
    userAgent: await page.evaluate(() => navigator.userAgent),
    hasTouch: true,
    isMobile: true,
    viewport: { width: 393, height: 659 },
  } : {})
  try {
    await drive.install(second, browserName === 'webkit')
    const other = await second.newPage()
    const reopened = await openPdf(other)
    const mark = reopened.locator('.pdf-user-mark')
    await expect(mark).toBeVisible()
    const rectangle = (await mark.boundingBox())!
    const x = rectangle.x + rectangle.width / 2
    const y = rectangle.y + rectangle.height / 2
    if (isMobile) await other.touchscreen.tap(x, y)
    else await other.mouse.click(x, y)
    await expect(mark).toHaveCount(0)
    await expect(reopened.getByRole('status').filter({ hasText: 'Subrayado quitado' })).toBeVisible()
    await expect.poll(() => drive.savedStudy()).toContain('"value":null')
    await reopened.getByRole('button', { name: 'Deshacer', exact: true }).click()
    await expect(mark).toBeVisible()
    await expect.poll(() => drive.savedStudy()).not.toContain('"value":null')
  } finally {
    await second.close()
  }
})

test('removes overlapping legacy marks together in one undoable tap', async ({ page, context, browserName, isMobile }) => {
  const drive = new DriveFixture()
  const rect = { x: 0.04, y: 0.06, width: 0.12, height: 0.035 }
  drive.seedPdfAnnotations('test-pdf-one', [rect, rect, { ...rect, x: 0.4 }].map((position, index) => ({
    id: `legacy-highlight-${index}`, page: 1, kind: 'highlight', rects: [position], createdAt: new Date(index).toISOString(),
  })))
  await drive.install(context, browserName === 'webkit')
  const reader = await openPdf(page)
  const marks = reader.locator('.pdf-user-mark')
  await expect(marks).toHaveCount(3)
  const hit = (await marks.first().boundingBox())!
  const x = hit.x + hit.width / 2
  const y = hit.y + hit.height / 2
  if (isMobile) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
  await expect(marks).toHaveCount(1)
  await expect(marks).toHaveAttribute('data-highlight-id', 'legacy-highlight-2')
  await expect.poll(() => drive.savedStudy().match(/"value":null/g)?.length).toBe(2)

  await reader.getByRole('button', { name: 'Deshacer', exact: true }).click()
  await expect(marks).toHaveCount(3)
  await reader.getByRole('button', { name: 'Rehacer', exact: true }).click()
  await expect(marks).toHaveCount(1)
})

test('closes in-document results after a jump and keeps the match highlighted', async ({ page, context, browserName }) => {
  await new DriveFixture().install(context, browserName === 'webkit')
  const reader = await openPdf(page)
  const search = reader.getByRole('button', { name: 'Buscar en este PDF' })
  await search.click()
  const query = reader.getByRole('searchbox', { name: 'Texto para buscar dentro del PDF' })
  await query.fill('observacion objetivo')
  await reader.getByRole('button', { name: 'Buscar', exact: true }).click()
  await reader.getByRole('button', { name: /Pág. 2/ }).click()
  await expect(query).not.toBeVisible()
  await expect(reader.getByRole('textbox', { name: 'Número de página' })).toHaveValue('2')
  await expect(reader.locator('[data-pdf-page="2"] .pdf-search-mark').first()).toBeVisible()
  await search.click()
  await expect(query).toHaveValue('observacion objetivo')
})
