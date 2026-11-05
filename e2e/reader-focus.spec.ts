import { expect, test } from '@playwright/test'
import { DriveFixture } from './fixtures'

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
  await reader.locator('.textLayer span').first().evaluate(span => {
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
