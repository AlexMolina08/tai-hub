import { expect, test, type Page } from '@playwright/test'
import { DriveFixture } from './fixtures'

test('returns to the same line, zoom and reading mode after reload and across browsers', async ({
  page, browser, context, browserName,
}) => {
  const drive = new DriveFixture()
  drive.addPdf('test-resume', 'Lectura exacta de prueba', ['Primera página', 'Párrafo para reanudar', 'Tercera página'])
  const bridge = browserName === 'webkit'
  await drive.install(context, bridge)
  async function connect(tab: Page) {
    await tab.goto('/tai-hub/')
    await tab.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
    await expect(tab.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  }
  const reader = (tab: Page) => tab.getByRole('dialog', { name: 'Modo lectura PDF' })
  const scroller = (tab: Page) => reader(tab).getByRole('region', { name: 'Página del PDF' })
  async function expectReadingPoint(tab: Page, horizontal?: number) {
    await expect(reader(tab).getByRole('img', { name: 'Página 2 del PDF' })).toBeVisible()
    await expect(reader(tab).getByRole('button', { name: 'Ajustar al ancho' })).toHaveText('125 %')
    await expect.poll(() => scroller(tab).evaluate(host => {
      const sheet = host.querySelector<HTMLElement>('[data-pdf-page="2"]')!
      return Math.abs((host.scrollTop - sheet.offsetTop) / sheet.clientHeight - 0.37)
    })).toBeLessThan(0.005)
    if (horizontal !== undefined) {
      await expect.poll(async () => Math.abs(await scroller(tab).evaluate(host => host.scrollLeft) - horizontal)).toBeLessThan(2)
    }
  }

  await connect(page)
  const search = page.getByRole('textbox', { name: 'Buscar en la biblioteca' })
  await search.fill('parrafo para reanudar')
  await page.getByRole('button', { name: /Lectura exacta de prueba General · Página 2/ }).click()
  await page.getByRole('button', { name: 'Modo lectura', exact: true }).click()
  await reader(page).getByRole('button', { name: 'Aumentar zoom' }).click()
  await expect(reader(page).getByRole('img', { name: 'Página 2 del PDF' })).toBeVisible()
  const horizontal = await scroller(page).evaluate(host => {
    const sheet = host.querySelector<HTMLElement>('[data-pdf-page="2"]')!
    host.scrollTop = sheet.offsetTop + sheet.clientHeight * 0.37
    host.scrollLeft = 30
    return host.scrollLeft
  })
  expect(horizontal).toBeGreaterThan(0)

  await page.reload()
  await expectReadingPoint(page, horizontal)
  await expect.poll(() => drive.savedStudy()).toMatch(/"offset":0\.3[56-8]/)
  await reader(page).getByRole('button', { name: 'Salir del modo lectura' }).click()
  await page.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect(search).toHaveValue('parrafo para reanudar')
  await expect(page.getByRole('heading', { name: 'Búsqueda', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()

  const other = await browser.newContext()
  try {
    await drive.install(other, bridge)
    const tab = await other.newPage()
    await connect(tab)
    await tab.getByRole('button', { name: 'Abrir último recurso' }).click()
    await expect(tab.getByRole('img', { name: 'Página 2 del PDF' })).toBeVisible()
    await expect(tab.getByRole('button', { name: 'Ajustar al ancho' })).toHaveText('125 %')
    await expect.poll(() => tab.getByRole('region', { name: 'Página del PDF' }).evaluate(host => {
      const sheet = host.querySelector<HTMLElement>('[data-pdf-page="2"]')!
      return Math.abs((host.scrollTop - sheet.offsetTop) / sheet.clientHeight - 0.37)
    })).toBeLessThan(0.01)
  } finally {
    await other.close()
  }
})
