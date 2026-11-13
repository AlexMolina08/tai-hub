import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { sampleAttempt, samplePackage } from '../src/lab/fixtures.test-support'
import { DriveFixture } from './fixtures'

function topicPackage(id: string, topic: string, title: string, version = '1') {
  const pack = samplePackage()
  pack.id = id
  pack.version = version
  pack.objectives[0].topicId = topic
  pack.objectives[0].unitId = `${topic}-U01`
  pack.lessons[0].title = title
  return pack
}

async function openMap(page: Page, context: BrowserContext, browserName: string, drive: DriveFixture) {
  await drive.install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  const direct = page.getByRole('button', { name: 'Abrir Laboratorio TAI', exact: true })
  if (await direct.isVisible()) await direct.click()
  else {
    const menu = page.getByRole('button', { name: 'Abrir navegación', exact: true })
    if (await menu.isVisible()) await menu.click()
    await page.getByRole('button', { name: 'Laboratorio TAI', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Cargar lecciones de Drive', exact: true }).click()
  const catalogue = page.getByRole('region', { name: 'Explorar lecciones' })
  await expect(catalogue).toBeVisible()
  return catalogue
}

test('study map restores the selected block, topic and search result on browser Back', async ({ page, context, browserName }) => {
  const drive = new DriveFixture()
  drive.addLabPackage('map-start', topicPackage('map-start', 'III.1', 'Modelado inicial'))
  drive.addLabPackage('map-sql', topicPackage('map-sql', 'III.3', 'Agregación con SQL'))
  drive.addLabPackage('map-network', topicPackage('map-network', 'IV.7', 'Comunicación entre redes'))
  const map = await openMap(page, context, browserName, drive)
  const block = map.getByRole('button', { name: 'Bloque IV', exact: true })
  await block.click()
  const topic = map.getByRole('button', { name: /IV\.7.*0 de 1 lecciones/ })
  await expect(topic).toBeVisible()
  const search = map.getByRole('searchbox', { name: 'Buscar lecciones' })
  await search.fill('IV.7')
  await topic.click()
  const detail = map.locator('.study-topic-detail')
  await expect(detail.getByRole('heading', { level: 2 })).toBeFocused()
  await expect(detail.getByRole('button', { name: 'Continuar tema' })).toBeVisible()
  await detail.getByRole('button', { name: 'Continuar tema' }).click()
  await expect(page.getByRole('heading', { name: 'Comunicación entre redes', exact: true })).toBeVisible()
  await page.goBack()
  await expect(detail.getByRole('button', { name: 'Continuar tema' })).toBeFocused()
  await page.goBack()
  await expect(search).toHaveValue('IV.7')
  await expect(topic).toBeFocused()
  const result = map.getByRole('button', { name: /Comunicación entre redes/ })
  await result.click()
  await expect(page.getByRole('heading', { name: 'Comunicación entre redes', exact: true })).toBeVisible()
  await page.goBack()
  await expect(result).toBeFocused()
  await expect(search).toHaveValue('IV.7')
  await map.getByRole('button', { name: 'Volver al mapa' }).click()
  await expect(block).toHaveAttribute('aria-pressed', 'true')
  await expect(search).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.study-map').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
})

test('study map keeps omitted work pending and exposes a completed older edition without merging progress', async ({ page, context, browserName }) => {
  const drive = new DriveFixture()
  const older = topicPackage('map-editions', 'III.3', 'Consultas agrupadas', '1.2')
  const current = topicPackage('map-editions', 'III.3', 'Consultas agrupadas', '1.10')
  const complete = topicPackage('map-complete', 'III.3', 'Ordenar filas')
  complete.objectives[0].unitId = 'III.3-U02'
  drive.addLabPackage('map-old', older)
  drive.addLabPackage('map-current', current)
  drive.addLabPackage('map-complete', complete)
  const attempts = [older, current, complete].flatMap(pack => pack.activities
    .filter(activity => activity.phase === 'practice' || activity.phase === 'immediate')
    .map((activity, index) => {
      const omitted = pack === current && index === 0
      const id = `${pack.id}-${pack.version}-${activity.id}`
      return { ...sampleAttempt(id), accountId: 'sample-account', packageId: pack.id, packageVersion: pack.version,
        activityId: activity.id, activityVersion: activity.version, familyId: activity.familyId,
        phase: activity.phase, answer: omitted ? null : 'b', outcome: omitted ? 'omitted' as const : 'incorrect' as const }
    }))
  drive.addLabHistory('map-progress', attempts)
  const map = await openMap(page, context, browserName, drive)
  const topic = map.getByRole('button', { name: /III\.3.*50 %.*1 de 2 lecciones/ })
  await expect(topic).toBeVisible()
  await topic.click()
  const detail = map.locator('.study-topic-detail')
  await expect(detail.getByText('50 % · 1 de 2 lecciones completadas')).toBeVisible()
  const currentLesson = detail.getByRole('button', { name: /Consultas agrupadas/ })
  await expect(currentLesson).toHaveCount(1)
  await expect(currentLesson).toContainText('4 de 5 actividades respondidas')
  await expect(detail.getByRole('button', { name: /Ordenar filas/ })).toContainText('Completada')
  await map.getByRole('checkbox', { name: 'Mostrar ediciones anteriores' }).check()
  await expect(currentLesson).toHaveCount(2)
  await expect(detail.getByRole('button', { name: /Consultas agrupadas.*Edición 1\.2/ })).toContainText('5 de 5 actividades respondidas')
  await expect(detail.getByText('50 % · 1 de 2 lecciones completadas')).toBeVisible()
})
