import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

const feedUrl = 'https://raw.githubusercontent.com/AlexMolina08/tai-hub/official-data/official-inap.json'

test('shows an INAP update without Drive access and remembers when it was read', async ({ page, context }) => {
  const feed = JSON.parse(await readFile('public/official-inap.json', 'utf8'))
  const notice = {
    id: feed.sequence + 1, at: new Date().toISOString(), label: 'Publicación oficial de prueba',
    url: 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-26262',
  }
  await context.route(feedUrl, route => route.fulfill({
    headers: { 'access-control-allow-origin': '*' },
    json: { ...feed, sequence: notice.id, changes: [notice, ...feed.changes] },
  }))
  await context.route('https://accounts.google.com/gsi/client', route => route.abort())
  await page.goto('/tai-hub/')

  const alerts = page.getByRole('button', { name: 'Convocatorias INAP, novedades disponibles' })
  await expect(alerts).toBeVisible()
  await alerts.click()
  await expect(page.getByRole('heading', { name: 'INAP y BOE' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Publicación oficial de prueba/ })).toHaveAttribute('href', notice.url)
  await expect(page.getByRole('heading', { name: /Última convocatoria|Convocatoria 20/ }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Marcar como leídos' }).click()
  await expect(alerts).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Marcar como leídos' })).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Convocatorias INAP', exact: true }).click()
  await expect(page.getByRole('link', { name: /Publicación oficial de prueba/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Marcar como leídos' })).toHaveCount(0)
})
