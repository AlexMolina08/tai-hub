import { expect, test } from '@playwright/test'
import { DriveFixture } from './fixtures'

test('restores library filters and scroll when returning from a resource', async ({ context, page, browserName }) => {
  const drive = new DriveFixture()
  for (let i = 1; i <= 35; i++) drive.addVideo(`library-video-${i}`, `Vídeo de biblioteca ${i}`)
  await drive.install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await page.getByRole('button', { name: 'General', exact: true }).first().click()

  const filters = page.locator('.filters select')
  await filters.nth(0).selectOption('video')
  await filters.nth(1).selectOption('Fuente sintética')
  await filters.nth(2).selectOption('prueba')
  await expect(page.locator('.resource-row')).toHaveCount(36)

  const resource = page.getByRole('button', { name: /^Vídeo de biblioteca 24 / })
  await resource.evaluate(element => element.scrollIntoView({ block: 'center' }))
  const scroll = await page.evaluate(() => window.scrollY)
  expect(scroll).toBeGreaterThan(500)
  await resource.click()
  await page.getByRole('button', { name: 'Volver', exact: true }).click()

  await expect(filters.nth(0)).toHaveValue('video')
  await expect(filters.nth(1)).toHaveValue('Fuente sintética')
  await expect(filters.nth(2)).toHaveValue('prueba')
  await expect(page.locator('.resource-row')).toHaveCount(36)
  await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - scroll)).toBeLessThan(3)
})

test('shows search matches beyond the first batch of resources and PDF pages', async ({ context, page, browserName }) => {
  const drive = new DriveFixture()
  for (let i = 1; i <= 87; i++) drive.addVideo(`search-video-${i}`, `Coincidencia extensa ${i}`)
  drive.addPdf('many-matches', 'Muchas páginas', Array.from({ length: 87 }, (_, i) => `Coincidencia extensa ${i + 1}`))
  await drive.install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  const query = page.getByRole('textbox', { name: 'Buscar en la biblioteca' })
  await query.fill('Coincidencia extensa')

  const resources = page.locator('.search-results section').filter({ has: page.getByRole('heading', { name: /^Recursos/ }) })
  const pages = page.locator('.search-results section').filter({ has: page.getByRole('heading', { name: /^Dentro de PDF/ }) })
  await expect(resources.locator('.search-item')).toHaveCount(80)
  await resources.getByRole('button', { name: 'Mostrar más recursos' }).click()
  await expect(resources.locator('.search-item')).toHaveCount(87)
  await expect(resources.getByRole('button', { name: /^Coincidencia extensa 87 / })).toBeVisible()

  await expect(pages.locator('.search-item')).toHaveCount(80, { timeout: 15_000 })
  await expect(pages.getByRole('heading')).toHaveText('Dentro de PDF 80+')
  await pages.getByRole('button', { name: 'Mostrar más páginas' }).click()
  await expect(pages.locator('.search-item')).toHaveCount(87)
  await expect(pages.getByRole('button', { name: /Página 87 / })).toBeVisible()

  await resources.getByRole('button', { name: /^Coincidencia extensa 87 / }).click()
  await page.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect(query).toHaveValue('Coincidencia extensa')
  await expect(resources.locator('.search-item')).toHaveCount(87)
  await expect(pages.locator('.search-item')).toHaveCount(87)
})

test('offers a Drive link and original download without promising Matroska playback', async ({ context, page, browserName }) => {
  const drive = new DriveFixture()
  drive.addVideo('matroska', 'Grabación de prueba', 'mkv')
  await drive.install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await page.getByRole('button', { name: 'General', exact: true }).first().click()
  await page.getByRole('button', { name: /^Grabación de prueba / }).click()

  await expect(page.getByRole('link', { name: 'Abrir en Drive' })).toHaveAttribute('href', 'https://drive.google.com/file/d/matroska/view')
  await expect(page.getByRole('link', { name: 'Reproducir en Drive' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Descargar original' })).toBeVisible()
  expect(drive.mediaReads).not.toContain('matroska')
})
