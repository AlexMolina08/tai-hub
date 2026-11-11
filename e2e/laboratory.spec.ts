import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { DriveFixture } from './fixtures'
import { samplePackage } from '../src/lab/fixtures.test-support'
import { readFile, writeFile } from 'node:fs/promises'
import type { LabEvent } from '../src/lab/model'

async function openLab(page: import('@playwright/test').Page) {
  const menu = page.getByRole('button', { name: 'Abrir navegación', exact: true })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('button', { name: 'Laboratorio TAI', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Laboratorio TAI', exact: true })).toBeVisible()
}
async function showPractice(page: import('@playwright/test').Page) {
  const button = page.getByRole('button', { name: 'Practicar', exact: true })
  if ((page.viewportSize()?.width ?? 1440) <= 800) {
    await expect(button).toBeVisible(); await button.click()
  } else await expect(button).toHaveCount(0)
}
async function openStudyOptions(page: import('@playwright/test').Page) {
  if (await page.locator('.lab-tools').getAttribute('open') === null) await page.getByText('Opciones de estudio', { exact: true }).click()
}
test('private lesson persists answers, assistance and retries across navigation', async ({ page, context, browserName }) => {
  const drive = new DriveFixture(); drive.addLabPackage('lab-fixture', samplePackage())
  await drive.install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await openLab(page)
  await page.getByRole('button', { name: 'Cargar lecciones de Drive' }).click()
  await page.getByRole('button', { name: /Lección sintética/ }).click()
  await showPractice(page)
  await page.getByRole('button', { name: 'Pista 1', exact: true }).click()
  await page.getByRole('radio', { name: 'Inválida', exact: true }).check()
  await page.getByRole('button', { name: 'Comprobar respuesta', exact: true }).click()
  await expect(page.getByText('Revisa la respuesta · Con ayuda', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Volver a las lecciones' }).click()
  await page.getByRole('button', { name: /Lección sintética/ }).click()
  await showPractice(page)
  await expect(page.getByRole('radio', { name: 'Inválida', exact: true })).toBeChecked()
  await expect(page.getByText('Pista 1: Pista uno.', { exact: true })).toBeVisible()
  await page.getByRole('radio', { name: 'Válida', exact: true }).check()
  await page.getByRole('button', { name: 'Comprobar respuesta', exact: true }).click()
  await expect(page.getByText('Respuesta correcta · Con ayuda', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sincronizar progreso', exact: true }).click()
  await expect.poll(() => drive.labEvents().filter(e => typeof e === 'object' && e !== null && 'kind' in e && e.kind === 'attempt').length).toBeGreaterThanOrEqual(2)
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll')
})
test('rejects a planned package and retains the 19 topic map', async ({ page, context, browserName }) => {
  const pack = samplePackage(); pack.objectives[0].state = 'planned'
  const drive = new DriveFixture(); drive.addLabPackage('lab-unreviewed', pack)
  await drive.install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await openLab(page)
  await page.getByRole('button', { name: 'Cargar lecciones de Drive' }).click()
  await expect(page.getByRole('alert')).toContainText('no validado')
  await page.getByText('Mapa de los 19 temas', { exact: true }).click()
  await expect(page.locator('.lab-map li')).toHaveCount(19)
})

test('resumes the exact saved activity on a second browser context and retains subsequent navigation', async ({ page, context, browser, browserName }) => {
  const drive = new DriveFixture(); drive.addLabPackage('lab-continuation', samplePackage())
  await drive.install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await openLab(page)
  await page.getByRole('button', { name: 'Cargar lecciones de Drive' }).click()
  await page.getByRole('button', { name: /Lección sintética/ }).click()
  await showPractice(page)
  await page.getByRole('button', { name: '2', exact: true }).click()
  await page.getByRole('radio', { name: 'Inválida', exact: true }).check()
  await page.getByRole('button', { name: 'Pista 1', exact: true }).click()
  await expect(page.getByText('Pista 1: Pista uno.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sincronizar progreso', exact: true }).click()
  await expect.poll(() => drive.labEvents().filter((event: any) => event.kind === 'assistance').length).toBe(1)

  const other = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    await drive.install(other, browserName === 'webkit')
    const resumed = await other.newPage()
    await resumed.goto(page.url())
    await resumed.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
    await expect(resumed.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
    await openLab(resumed)
    await resumed.getByRole('button', { name: 'Cargar lecciones de Drive' }).click()
    const card = resumed.getByRole('region', { name: 'Retomar el laboratorio' })
    await expect(card).toContainText('Actividad 2: Ejemplo sintético p2')
    expect(await resumed.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page: resumed }).include('.lab-continuation').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
    await resumed.screenshot({ path: `test-results/laboratory-continuation-${browserName}-390.png`, fullPage: true })
    await resumed.getByRole('button', { name: 'Reanudar actividad', exact: true }).click()
    await expect(resumed.getByRole('heading', { name: 'Ejemplo sintético p2', exact: true })).toBeVisible()
    await expect(resumed.getByRole('radio', { name: 'Inválida', exact: true })).toBeChecked()
    await expect(resumed.getByText('Pista 1: Pista uno.', { exact: true })).toBeVisible()
    await resumed.getByRole('button', { name: '3', exact: true }).click()
    await expect(resumed.getByRole('heading', { name: 'Ejemplo sintético i1', exact: true })).toBeVisible()
    await resumed.reload()
    // Reload can perform an authentication redirect before the mobile menu exists.
    await expect(resumed.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
    await expect(resumed.getByRole('button', { name: 'Abrir navegación', exact: true })).toBeVisible()
    await openLab(resumed)
    await expect(resumed.getByRole('heading', { name: 'Ejemplo sintético i1', exact: true })).toBeVisible()
    await expect(resumed.getByRole('button', { name: 'Pista 1', exact: true })).toHaveCount(0)
  } finally { await other.close() }
})

test('SQL runs in a disposable isolated executor with real NULL and duplicate semantics', async ({ page, context, browserName }) => {
  test.setTimeout(90_000)
  const pack = samplePackage()
  pack.activities[0] = { ...pack.activities[0], kind: 'sql', starter: 'SELECT n FROM demo ORDER BY n NULLS LAST',
    referenceQuery: 'SELECT n FROM demo ORDER BY n NULLS LAST', comparison: 'bag',
    datasets: [{ id: 'normal', setup: 'CREATE TABLE demo(n integer); INSERT INTO demo VALUES (2),(2),(NULL);' },
      { id: 'empty', setup: 'CREATE TABLE demo(n integer);' }] }
  const drive = new DriveFixture(); drive.addLabPackage('lab-sql', pack)
  await drive.install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await openLab(page)
  await page.getByRole('button', { name: 'Cargar lecciones de Drive' }).click()
  await page.getByRole('button', { name: /Lección sintética/ }).click()
  await showPractice(page)
  await page.getByRole('button', { name: 'Ejecutar SQL', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Resultado de la consulta' })).toContainText('3 filas.', { timeout: 25_000 })
  await expect(page.getByRole('cell', { name: 'NULL', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Comprobar SQL', exact: true }).click()
  await expect(page.getByText('Correcta en los casos comprobados.', { exact: true })).toBeVisible({ timeout: 45_000 })

  const query = page.getByRole('textbox', { name: 'Consulta SQL' })
  await query.fill('SELEC n FROM demo')
  await page.getByRole('button', { name: 'Comprobar SQL', exact: true }).click()
  await expect(page.getByText(/syntax error/)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Sincronizar progreso', exact: true }).click()
  await expect.poll(() => drive.labEvents().filter((e: any) => e.kind === 'attempt' && e.outcome === 'incorrect').length).toBe(1)
  await query.fill('SELECT pg_sleep(20)')
  await page.getByRole('button', { name: 'Ejecutar SQL', exact: true }).click()
  await expect(page.locator('iframe[title="Motor SQL aislado"]')).toHaveCount(1)
  const sandbox = page.frames().find(f => f !== page.mainFrame() && f.url() === 'about:srcdoc')!
  const protections = await sandbox.evaluate(async () => {
    let parentBlocked = false, storageBlocked = false, networkBlocked = false
    try { void parent.document.body } catch { parentBlocked = true }
    try { localStorage.setItem('test', 'value') } catch { storageBlocked = true }
    try { await fetch('https://www.googleapis.com/drive/v3/files') } catch { networkBlocked = true }
    return { parentBlocked, storageBlocked, networkBlocked }
  })
  expect(protections).toEqual({ parentBlocked: true, storageBlocked: true, networkBlocked: true })
  await page.evaluate(() => window.postMessage({ kind: 'result', token: 'forged', rows: [['forged']], columns: ['x'] }, '*'))
  await expect(page.getByRole('cell', { name: 'forged', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancelar ejecución', exact: true }).click()
  await expect(page.getByText(/Ejecución cancelada/, { exact: false })).toBeVisible()
  await expect(page.locator('iframe[title="Motor SQL aislado"]')).toHaveCount(0)
  await query.fill('SELECT generate_series(1, 201)')
  await page.getByRole('button', { name: 'Ejecutar SQL', exact: true }).click()
  await expect(page.getByText('La salida supera 200 filas o 100 KB. Reduce el resultado.', { exact: true })).toBeVisible({ timeout: 20_000 })
  await query.fill('SELECT count(*) FROM demo')
  await page.getByRole('button', { name: 'Ejecutar SQL', exact: true }).click()
  await expect(page.getByRole('cell', { name: '3', exact: true })).toBeVisible({ timeout: 20_000 })
  await query.fill('SELECT pg_sleep(30)')
  await page.getByRole('button', { name: 'Ejecutar SQL', exact: true }).click()
  await expect(page.getByText(/statement timeout|límite de ejecución/)).toBeVisible({ timeout: 18_000 })
  await expect(page.locator('iframe[title="Motor SQL aislado"]')).toHaveCount(0)
})

test('lesson controls and content fit required screen widths', async ({ page, context, browserName }) => {
  const drive = new DriveFixture(); drive.addLabPackage('lab-responsive', samplePackage())
  await drive.install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await openLab(page)
  await page.getByRole('button', { name: 'Cargar lecciones de Drive' }).click()
  await page.getByRole('button', { name: /Lección sintética/ }).click()
  await showPractice(page)
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await showPractice(page)
    await expect(page.getByRole('button', { name: 'Comprobar respuesta', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `test-results/laboratory-${browserName}-390.png`, fullPage: true })
})

test('opens the exact material section and returns to the same activity', async ({ page, context, browserName }) => {
  const drive = new DriveFixture(); drive.addLabPackage('lab-links', samplePackage())
  drive.addHtml('synthetic-html', 'Material sintético', '<p>Inicio</p>' + '<p>Contexto.</p>'.repeat(100) + '<h2 id="fixture">Apartado exacto</h2>' + '<p>Detalle.</p>'.repeat(20))
  await drive.install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await openLab(page)
  await page.getByRole('button', { name: 'Cargar lecciones de Drive' }).click()
  await page.getByRole('button', { name: /Lección sintética/ }).click()
  await showPractice(page)
  await page.getByRole('button', { name: '2', exact: true }).click()
  await page.getByRole('radio', { name: 'Inválida', exact: true }).check()
  const read = page.getByRole('button', { name: 'Leer explicación', exact: true })
  if (await read.isVisible()) await read.click()
  await page.getByRole('button', { name: 'Consultar material completo', exact: true }).click()
  const frame = page.frameLocator('iframe[title="Material sintético"]')
  await expect(frame.getByRole('heading', { name: 'Apartado exacto' })).toBeInViewport()
  await page.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Ejemplo sintético p2', exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Inválida', exact: true })).toBeChecked()
})

test('cold offline reload preserves private content and executes the downloaded SQL engine', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit offline emulation rejects even literal service-worker responses: https://github.com/microsoft/playwright/issues/42775. Physical Safari remains required.')
  test.setTimeout(100_000)
  const pack = samplePackage()
  pack.activities[0] = { ...pack.activities[0], kind: 'sql', starter: 'SELECT count(*) FROM demo',
    referenceQuery: 'SELECT count(*) FROM demo', comparison: 'bag',
    datasets: [{ id: 'normal', setup: 'CREATE TABLE demo(n integer); INSERT INTO demo VALUES (2),(NULL);' },
      { id: 'empty', setup: 'CREATE TABLE demo(n integer);' }] }
  const drive = new DriveFixture(); drive.addLabPackage('lab-offline', pack)
  await drive.install(context, browserName === 'webkit')
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await openLab(page)
  await page.getByRole('button', { name: 'Cargar lecciones de Drive' }).click()
  await openStudyOptions(page)
  await page.getByText('Acceso sin conexión: por preparar', { exact: true }).click()
  await page.getByRole('button', { name: 'Preparar acceso sin conexión', exact: true }).click()
  await expect(page.getByText('Acceso sin conexión: preparado', { exact: true })).toBeVisible({ timeout: 45_000 })
  await page.getByText('Opciones de estudio', { exact: true }).click()
  await page.getByRole('button', { name: /Lección sintética/ }).click()
  await showPractice(page)
  await page.getByRole('textbox', { name: 'Consulta SQL' }).fill('SELECT n FROM demo WHERE n IS NULL')
  await page.getByRole('button', { name: 'Pista 1', exact: true }).click()
  await expect(page.getByText('Pista 1: Pista uno.', { exact: true })).toBeVisible()
  await context.setOffline(true)
  await page.reload()
  await openLab(page)
  await expect(page.getByRole('textbox', { name: 'Consulta SQL' })).toHaveValue('SELECT n FROM demo WHERE n IS NULL')
  await expect(page.getByText('Pista 1: Pista uno.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Ejecutar SQL', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'NULL', exact: true })).toBeVisible({ timeout: 25_000 })
  const publicCacheUrls = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(request.url)
    return urls
  })
  expect(publicCacheUrls.length).toBeGreaterThan(5)
  expect(publicCacheUrls.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true)
  expect(publicCacheUrls.some(url => /google|lab-offline\.json|labEvents|labPackage/.test(url))).toBe(false)
  await context.setOffline(false)
  await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) if (request.url.endsWith('.wasm')) await cache.delete(request)
    }
  })
  await openStudyOptions(page)
  await page.getByText('Acceso sin conexión: preparado', { exact: true }).click()
  await page.getByRole('button', { name: 'Comprobar descarga', exact: true }).click()
  await expect(page.getByText('Acceso sin conexión: por preparar', { exact: true })).toBeVisible()
})

test('two offline devices preserve attempts, surface draft conflicts and restore an export', async ({ browser, browserName, baseURL }) => {
  test.setTimeout(90_000)
  const drive = new DriveFixture(); drive.addLabPackage('lab-concurrent', samplePackage())
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
  try {
    for (const context of contexts.slice(0, 2)) await drive.install(context, browserName === 'webkit')
    await new DriveFixture().install(contexts[2], browserName === 'webkit')
    const [a, b, c] = await Promise.all(contexts.map(context => context.newPage()))
    for (const page of [a, b]) {
      await page.goto(baseURL + '/tai-hub/')
      await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
      await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
      await openLab(page)
      await page.getByRole('button', { name: 'Cargar lecciones de Drive' }).click()
      await page.getByRole('button', { name: 'Sincronizar progreso', exact: true }).click()
      await expect(page.getByRole('status', { name: '' }).filter({ hasText: /^Sincronizado$/ })).toBeVisible()
      await page.getByRole('button', { name: /Lección sintética/ }).click()
    await showPractice(page)
      await expect(page.getByRole('radio', { name: 'Válida', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: 'Sincronizar progreso', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: /^Sincronizado$/ })).toBeVisible()
    }
    for (const context of contexts.slice(0, 2)) await context.setOffline(true)
    await a.getByRole('radio', { name: 'Válida', exact: true }).check()
    await a.getByRole('button', { name: 'Comprobar respuesta', exact: true }).click()
    await expect(a.getByText('Respuesta correcta', { exact: true })).toBeVisible()
    await b.getByRole('radio', { name: 'Inválida', exact: true }).check()
    await b.getByRole('button', { name: 'Comprobar respuesta', exact: true }).click()
    await expect(b.getByText('Revisa la respuesta', { exact: true })).toBeVisible()
    for (const i of [1, 0]) {
      await contexts[i].setOffline(false)
      await [a, b][i].getByRole('button', { name: 'Sincronizar progreso', exact: true }).click()
      await expect([a, b][i].getByRole('status').filter({ hasText: /^Sincronizado$/ })).toBeVisible()
    }
    await expect(a.getByRole('heading', { name: 'Hay dos borradores de esta actividad' })).toBeVisible()
    await a.getByRole('button', { name: 'Continuar: a', exact: true }).click()
    await expect(a.getByRole('radio', { name: 'Válida', exact: true })).toBeChecked()
    const downloaded = a.waitForEvent('download')
    await openStudyOptions(a)
    await a.getByRole('button', { name: 'Exportar progreso', exact: true }).click()
    const exported = await readFile((await (await downloaded).path())!, 'utf8')
    const attempts = (JSON.parse(exported).events as LabEvent[]).filter(event => event.kind === 'attempt')
    expect(attempts).toHaveLength(2)
    expect(new Set(attempts.map(event => event.deviceId)).size).toBe(2)
    expect(attempts.map(event => event.outcome).sort()).toEqual(['correct', 'incorrect'])
    await c.goto(baseURL + '/tai-hub/')
    await c.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
    await expect(c.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
    await openLab(c)
    // Playwright's WebKit offline emulation also blocks native local File reads. Validate restore online there.
    if (browserName !== 'webkit') await contexts[2].setOffline(true)
    await c.getByText('Paquetes y copia del progreso', { exact: true }).click()
    const backupPath = test.info().outputPath('progress.json')
    await writeFile(backupPath, exported)
    await c.getByLabel('Restaurar progreso de esta cuenta', { exact: true }).setInputFiles(backupPath)
    await expect.poll(async () => {
      const rows = await c.evaluate(async () => new Promise<unknown[]>(resolve => {
        const open = indexedDB.open('tai-hub-laboratory-v1')
        open.onsuccess = () => {
          const database = open.result
          const request = database.transaction('accounts').objectStore('accounts').getAll()
          request.onsuccess = () => { resolve(request.result); database.close() }
        }
      }))
      return JSON.stringify(rows).includes(attempts[0].id)
    }).toBe(true)
    const restored = c.waitForEvent('download')
    await openStudyOptions(c)
    await c.getByRole('button', { name: 'Exportar progreso', exact: true }).click()
    expect(JSON.parse(await readFile((await (await restored).path())!, 'utf8')).events).toEqual(JSON.parse(exported).events)
  } finally { await Promise.all(contexts.map(context => context.close())) }
})

for (const language of ['python', 'javascript'] as const) {
  test(`${language} executes isolated code, grades fixed cases, limits output and preserves drafts`, async ({ page, context, browserName }) => {
    test.setTimeout(120_000)
    const source = language === 'python' ? 'print(sum(input))' : 'console.log(input.reduce((a, b) => a + b, 0))'
    const pack = samplePackage()
    pack.activities[0] = { ...pack.activities[0], kind: 'code', language, starter: source,
      datasets: [{ id: 'mixed', input: [2, -1, 2], expectedOutput: ['3'] }, { id: 'empty', input: [], expectedOutput: ['0'] }] }
    const drive = new DriveFixture(); drive.addLabPackage('lab-' + language, pack)
    await drive.install(context, browserName === 'webkit')
    const assets: string[] = [], forbidden: string[] = []
    page.on('request', r => { if (/pyodide|python_stdlib|python-assets/.test(r.url())) assets.push(r.url()); if (r.url().includes('/forbidden-program')) forbidden.push(r.url()) })
    await page.goto('/tai-hub/')
    await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
    await openLab(page)
    await page.getByRole('button', { name: 'Cargar lecciones de Drive' }).click()
    await page.getByRole('button', { name: /Lección sintética/ }).click()
    await showPractice(page)
    expect(assets).toEqual([])
    const editor = page.getByRole('textbox', { name: language === 'python' ? 'Código Python' : 'Código JavaScript' })
    const output = page.getByRole('region', { name: 'Salida del programa' })
    const execute = async (code: string) => { await editor.fill(code); await page.getByRole('button', { name: 'Ejecutar código', exact: true }).click() }
    await page.getByRole('button', { name: 'Comprobar código', exact: true }).click()
    await expect(page.getByText('Correcto en los casos comprobados.', { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(output).toHaveText('3')
    expect(assets.length > 0).toBe(language === 'python')
    await execute(language === 'python' ? 'print("marker" in globals())\nmarker=77' : 'console.log(typeof globalThis.marker); globalThis.marker=77')
    await expect(output).toHaveText(language === 'python' ? 'False' : 'undefined', { timeout: 25_000 })
    await execute(language === 'python' ? 'print("marker" in globals())' : 'console.log(typeof globalThis.marker)')
    await expect(output).toHaveText(language === 'python' ? 'False' : 'undefined', { timeout: 25_000 })
    await execute(language === 'python' ? 'print(1/0)' : 'throw Error("synthetic failure")')
    await expect(page.getByText(language === 'python' ? /ZeroDivisionError/ : 'synthetic failure', { exact: language !== 'python' })).toBeVisible({ timeout: 25_000 })
    await execute(language === 'python' ? 'for i in range(101): print(i)' : 'for(let i=0;i<101;i++) console.log(i)')
    await expect(page.getByText('La salida supera 100 líneas o 16 KB.', { exact: true })).toBeVisible({ timeout: 25_000 })
    const loop = language === 'python' ? 'while True: pass' : 'while(true) {}'
    await execute(loop)
    await expect(page.getByText(/Límite de ejecución: 2 segundos/)).toBeVisible({ timeout: 25_000 })
    await execute(loop)
    await expect(page.locator('iframe[title="Motor de código aislado"]')).toHaveCount(1)
    const sandbox = page.frames().find(f => f !== page.mainFrame() && f.url() === 'about:srcdoc')!
    expect(await sandbox.evaluate(async () => {
      let parentBlocked = false, storageBlocked = false, fetchBlocked = false
      try { void parent.document.body } catch { parentBlocked = true }
      try { localStorage.setItem('program', 'value') } catch { storageBlocked = true }
      try { await fetch('https://www.googleapis.com/forbidden-program') } catch { fetchBlocked = true }
      return { parentBlocked, storageBlocked, fetchBlocked }
    })).toEqual({ parentBlocked: true, storageBlocked: true, fetchBlocked: true })
    await page.getByRole('button', { name: 'Cancelar ejecución', exact: true }).click()
    await expect(page.getByText('Ejecución cancelada. El código está guardado.', { exact: true })).toBeVisible()
    await expect(page.locator('iframe[title="Motor de código aislado"]')).toHaveCount(0)
    await execute(language === 'python'
      ? 'from js import fetch\ntry:\n fetch("https://www.googleapis.com/forbidden-program")\nexcept Exception:\n print("blocked")'
      : 'try { await fetch("https://www.googleapis.com/forbidden-program") } catch { console.log("blocked") }')
    await expect(output).toHaveText('blocked', { timeout: 25_000 })
    expect(forbidden).toEqual([])
    await editor.fill(language === 'python' ? 'print(999)' : 'console.log(999)')
    await page.getByRole('button', { name: 'Comprobar código', exact: true }).click()
    await expect(page.getByText('El caso 1 produce otra salida. Revisa también los casos límite.', { exact: true })).toBeVisible({ timeout: 35_000 })
    await page.getByRole('button', { name: 'Volver a las lecciones', exact: true }).click()
    await page.getByRole('button', { name: /Lección sintética/ }).click()
    await showPractice(page)
    await expect(editor).toHaveValue(language === 'python' ? 'print(999)' : 'console.log(999)')
    await page.getByRole('button', { name: 'Sincronizar progreso', exact: true }).click()
    await expect.poll(() => drive.labEvents().filter((e: any) => e.kind === 'attempt').length).toBe(2)
    const attempts = drive.labEvents().filter((e: any) => e.kind === 'attempt') as any[]
    expect(attempts.map(a => a.outcome)).toEqual(['correct', 'incorrect'])
    expect(attempts[1].solutionViewed).toBe(true)
    await editor.fill('')
    await page.getByRole('button', { name: 'Volver a las lecciones', exact: true }).click()
    await page.getByRole('button', { name: /Lección sintética/ }).click(); await showPractice(page)
    await expect(editor).toHaveValue('')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('Python is cached only when needed and runs after an offline reload', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright42775 prevents offline service-worker navigation; native Safari/iPhone acceptance remains required.')
  test.setTimeout(90_000)
  const pack = samplePackage()
  pack.activities[0] = { ...pack.activities[0], kind: 'code', language: 'python', starter: 'print(sum(input))',
    datasets: [{ id: 'numbers', input: [2, 5], expectedOutput: ['7'] }, { id: 'empty', input: [], expectedOutput: ['0'] }] }
  const drive = new DriveFixture(); drive.addLabPackage('lab-python-offline', pack)
  await drive.install(context)
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await openLab(page)
  await page.getByRole('button', { name: 'Cargar lecciones de Drive' }).click()
  await openStudyOptions(page)
  await page.getByText('Acceso sin conexión: por preparar', { exact: true }).click()
  await page.getByRole('button', { name: 'Preparar acceso sin conexión', exact: true }).click()
  await expect(page.getByText('Acceso sin conexión: preparado', { exact: true })).toBeVisible({ timeout: 45_000 })
  await page.getByText('Opciones de estudio', { exact: true }).click()
  await page.getByRole('button', { name: /Lección sintética/ }).click()
  await showPractice(page)
  const editor = page.getByRole('textbox', { name: 'Código Python' })
  await editor.fill('print(sum(input) * 2)')
  await page.getByRole('button', { name: 'Pista 1', exact: true }).click()
  await expect(page.getByText('Pista 1: Pista uno.', { exact: true })).toBeVisible()
  const urls = await page.evaluate(async () => {
    const urls: string[] = []
    for (const key of await caches.keys()) for (const r of await (await caches.open(key)).keys()) urls.push(r.url)
    return urls
  })
  expect(urls.filter(url => /pyodide|python_stdlib|python-assets/.test(url))).toHaveLength(4)
  expect(urls.some(url => /pglite.*\.(wasm|data)|initdb.*wasm/.test(url))).toBe(false)
  await context.setOffline(true)
  await page.reload()
  await openLab(page)
  await expect(editor).toHaveValue('print(sum(input) * 2)')
  await page.getByRole('button', { name: 'Ejecutar código', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Salida del programa' })).toHaveText('14', { timeout: 25_000 })
  await context.setOffline(false)
  await page.evaluate(async () => {
    for (const key of await caches.keys()) {
      const cache = await caches.open(key)
      for (const r of await cache.keys()) if (r.url.includes('python_stdlib')) await cache.delete(r)
    }
  })
  await openStudyOptions(page)
  await page.getByText('Acceso sin conexión: preparado', { exact: true }).click()
  await page.getByRole('button', { name: 'Comprobar descarga', exact: true }).click()
  await expect(page.getByText('Acceso sin conexión: por preparar', { exact: true })).toBeVisible()
})

test('HTML CSS preview measures real responsive styles, removes active content and saves both editors', async ({ page, context, browserName }) => {
  const pack = samplePackage()
  const html = '<div id="box"><strong>Texto</strong></div>'
  const css = '#box{color:rgb(12,34,56);display:block}@media(min-width:600px){#box{display:flex}}'
  pack.activities[0] = { ...pack.activities[0], kind: 'html-css', starter: { html, css }, cases: [
    { id: 'small', width: 360, checks: [{ selector: '#box', kind: 'style', property: 'display', expected: 'block' }, { selector: '#box', kind: 'count', expected: '1' }] },
    { id: 'large', width: 800, checks: [{ selector: '#box', kind: 'style', property: 'display', expected: 'flex' }, { selector: '#box', kind: 'style', property: 'color', expected: 'rgb(12, 34, 56)' }] },
  ] }
  const drive = new DriveFixture(); drive.addLabPackage('lab-html-css', pack)
  await drive.install(context, browserName === 'webkit')
  const forbidden: string[] = []
  await context.route('**/forbidden-preview', route => { forbidden.push(route.request().url()); return route.abort() })
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await openLab(page)
  await page.getByRole('button', { name: 'Cargar lecciones de Drive' }).click()
  await page.getByRole('button', { name: /Lección sintética/ }).click()
  await showPractice(page)
  const htmlEditor = page.getByRole('textbox', { name: 'HTML', exact: true })
  const cssEditor = page.getByRole('textbox', { name: 'CSS', exact: true })
  await page.getByRole('button', { name: 'Comprobar HTML y CSS', exact: true }).click()
  await expect(page.getByText('El HTML y CSS cumplen los casos comprobados.', { exact: true })).toBeVisible()
  const preview = page.frameLocator('iframe[title="Resultado HTML y CSS"]')
  await expect(preview.locator('#box')).toHaveCSS('display', 'flex')
  await cssEditor.fill('#box{display:block}')
  await page.getByRole('button', { name: 'Comprobar HTML y CSS', exact: true }).click()
  await expect(page.getByText('Revisa #box a 800 px: display no cumple el requisito.', { exact: true })).toBeVisible()
  await htmlEditor.fill(html + '<script>parent.__previewLeak=true</script><img src="https://www.googleapis.com/forbidden-preview"><a href="https://example.org" onclick="parent.__previewLeak=true">Link</a><iframe src="https://www.googleapis.com/forbidden-preview"></iframe>')
  await cssEditor.fill('@import "https://www.googleapis.com/forbidden-preview"; #box{background-image:url("https://www.googleapis.com/forbidden-preview");color:red}</STYLE><script>parent.__previewLeak=true</script>')
  await page.getByRole('button', { name: 'Actualizar vista', exact: true }).click()
  await expect(page.getByText('Vista actualizada. Puedes modificarla o comprobarla.', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => '__previewLeak' in window)).toBe(false)
  await expect(preview.locator('img,iframe')).toHaveCount(0)
  await expect(preview.locator('a')).not.toHaveAttribute('href')
  await expect(preview.locator('a')).not.toHaveAttribute('onclick')
  await expect(preview.locator('script')).toHaveCount(1)
  const sandbox = page.frames().find(f => f !== page.mainFrame() && f.url() === 'about:srcdoc')!
  expect(await sandbox.evaluate(() => {
    let parentBlocked = false, storageBlocked = false
    try { void parent.document.body } catch { parentBlocked = true }
    try { localStorage.setItem('x', 'y') } catch { storageBlocked = true }
    return { parentBlocked, storageBlocked }
  })).toEqual({ parentBlocked: true, storageBlocked: true })
  expect(forbidden).toEqual([])
  await htmlEditor.fill('<div></div>'.repeat(201))
  await page.getByRole('button', { name: 'Actualizar vista', exact: true }).click()
  await expect(page.getByText('La vista admite hasta 200 elementos.', { exact: true })).toBeVisible()
  await htmlEditor.fill(html); await cssEditor.fill(css)
  await page.getByRole('button', { name: 'Comprobar HTML y CSS', exact: true }).click()
  await expect(page.getByText('El HTML y CSS cumplen los casos comprobados.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Volver a las lecciones', exact: true }).click()
  await page.getByRole('button', { name: /Lección sintética/ }).click(); await showPractice(page)
  await expect(htmlEditor).toHaveValue(html); await expect(cssEditor).toHaveValue(css)
  await page.getByRole('button', { name: 'Sincronizar progreso', exact: true }).click()
  await expect.poll(() => drive.labEvents().filter((e: any) => e.kind === 'attempt').length).toBe(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})


test('laboratory supports keyboard answers, enlarged text and automated accessibility checks', async ({ page, context, browserName }, testInfo) => {
  const drive = new DriveFixture(); drive.addLabPackage('lab-accessibility', samplePackage())
  await drive.install(context, browserName === 'webkit')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/tai-hub/')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continuar estudio' })).toBeVisible()
  await openLab(page)
  await page.getByRole('button', { name: 'Cargar lecciones de Drive' }).click()
  await page.getByRole('button', { name: /Lección sintética/ }).click()
  await showPractice(page)
  const answer = page.getByRole('radio', { name: 'Válida', exact: true })
  await expect(answer).toBeEnabled(); await answer.focus(); await page.keyboard.press('Space')
  await expect(answer).toBeChecked()
  const check = page.getByRole('button', { name: 'Comprobar respuesta', exact: true })
  await expect(check).toBeEnabled(); await check.focus(); await page.keyboard.press('Enter')
  await expect(page.getByText('Respuesta correcta', { exact: true })).toBeVisible()
  const accessibility = await new AxeBuilder({ page }).include('.laboratory').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  await testInfo.attach('laboratory-accessibility.json', { body: JSON.stringify(accessibility, null, 2), contentType: 'application/json' })
  expect(accessibility.violations).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 }); await showPractice(page)
  await page.evaluate(() => document.documentElement.style.fontSize = '200%')
  await expect(check).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
