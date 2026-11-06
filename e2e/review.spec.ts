import { expect, test } from '@playwright/test'
import { DriveFixture } from './fixtures'

test('explains why a resource needs review and clears the flag when the updated location is saved', async ({ page, context }) => {
  const drive = new DriveFixture()
  drive.markForReview('test-pdf-one', ['GSI'])
  await drive.install(context)
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()

  const menu = page.getByRole('button', { name: 'Abrir navegación' })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('button', { name: 'Por revisar 1' }).click()
  await expect(page.getByRole('heading', { name: 'Por revisar' })).toBeVisible()
  await expect(page.getByText('Material de GSI. Confirma qué parte te sirve para TAI.')).toBeVisible()

  await page.getByRole('button', { name: 'Revisar ficha de Documento de prueba' }).click()
  const editor = page.getByRole('dialog', { name: 'Editar recurso' })
  await editor.getByLabel('Ubicación').selectOption('b2t4')
  await editor.getByRole('checkbox', { name: 'Pendiente de revisión' }).uncheck()
  await editor.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByText('No quedan recursos pendientes de revisión.')).toBeVisible()

  await page.getByRole('searchbox', { name: 'Buscar en la biblioteca' }).or(
    page.getByRole('textbox', { name: 'Buscar en la biblioteca' }),
  ).fill('Documento de prueba')
  await expect(page.getByRole('button', { name: /Documento de prueba II\.4/ })).toBeVisible()
})
