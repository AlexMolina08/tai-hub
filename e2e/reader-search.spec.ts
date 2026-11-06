import { expect, test } from '@playwright/test'
import { DriveFixture } from './fixtures'

test('finds early PDF matches before the last page and lets the next query supersede a scan', async ({ page, context, browserName }) => {
  const drive = new DriveFixture()
  drive.addPdf('test-search-progress', 'PDF de búsqueda progresiva',
    Array.from({ length: 20 }, (_, index) => index === 0 ? 'Primera coincidencia' : `Texto normal ${index + 1}`))
  await context.addInitScript(() => {
    const post = Worker.prototype.postMessage
    let resumed = false
    document.addEventListener('resume-test-search', () => { resumed = true }, { once: true })
    Worker.prototype.postMessage = function (...args: Parameters<typeof post>) {
      const [message] = args
      // Leave one page pending until the first result has been used.
      if (!resumed && message.action === 'GetTextContent' && message.data?.pageIndex === 10
        && document.querySelector('.pdf-reader')) {
        document.addEventListener('resume-test-search', () => Reflect.apply(post, this, args), { once: true })
      } else Reflect.apply(post, this, args)
    }
  })
  await drive.install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Buscar en la biblioteca' }).fill('PDF de búsqueda progresiva')
  await page.getByRole('button', { name: /^PDF de búsqueda progresiva General/ }).click()
  await page.getByRole('button', { name: 'Modo lectura', exact: true }).click()
  const reader = page.getByRole('dialog', { name: 'Modo lectura PDF' })
  await expect(reader.getByRole('img', { name: 'Página 1 del PDF' })).toBeVisible()

  await page.keyboard.press('Meta+f')
  const field = reader.getByRole('searchbox', { name: 'Texto para buscar dentro del PDF' })
  await expect(field).toBeFocused()
  await field.fill('primera coincidencia')
  await field.press('Enter')
  await expect(reader.getByRole('button', { name: /Pág\. 1 Primera coincidencia/ })).toBeVisible()
  await expect(reader.getByText(/Buscando/)).toBeVisible()

  await field.fill('texto normal')
  await field.press('Enter')
  await expect(reader.getByRole('button', { name: /Pág\. 2 Texto normal 2/ })).toBeVisible()
  await expect(reader.getByRole('button', { name: /Primera coincidencia/ })).toHaveCount(0)
  await page.evaluate(() => document.dispatchEvent(new Event('resume-test-search')))
  await expect(reader.getByText('19 páginas con coincidencias')).toBeVisible()

  await field.press('Escape')
  await expect(field).not.toBeVisible()
  await expect(reader).toBeVisible()
  await expect(reader.getByRole('button', { name: 'Buscar en este PDF' })).toBeFocused()
})
