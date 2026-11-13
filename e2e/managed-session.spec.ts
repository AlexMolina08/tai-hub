import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { DriveFixture } from './fixtures'
import { samplePackage } from '../src/lab/fixtures.test-support'

test('keeps Drive available after proactive renewal', async ({ page, context }) => {
  test.skip(process.env.VITE_DRIVE_SESSION !== 'managed', 'Requires the managed session build.')
  const drive = new DriveFixture()
  await drive.install(context)
  let requests = 0
  await context.route('**/tai-hub/session/token', route => route.fulfill({
    json: { accountId: 'sample-account', token: 'fixture-token', expiresIn: ++requests === 1 ? 70 : 3600 },
  }))
  await page.clock.install()
  await page.goto('/tai-hub/')
  const ready = page.getByRole('banner').getByRole('button', { name: 'Añadir recurso', exact: true })
  await expect(ready).toBeEnabled()
  await page.clock.fastForward(30_000)
  await expect.poll(() => requests).toBe(2)
  await expect(ready).toBeEnabled()
  expect(drive.redirectPrompts).toEqual([])
})

test('managed Drive session recovers after a rejected token and survives a reload', async ({ page, context, baseURL }) => {
  test.skip(process.env.VITE_DRIVE_SESSION !== 'managed', 'Requires the managed session build.')
  const drive = new DriveFixture()
  await drive.install(context)
  let requests = 0
  let signedIn = true
  let resume: () => void = () => {}
  const renewal = new Promise<void>(resolve => { resume = resolve })
  const address = new URL('/tai-hub/session/', baseURL)
  await context.route(address.href + '*', async route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1)
    if (action === 'logout') { signedIn = false; return route.fulfill({ json: {} }) }
    expect(action).toBe('token')
    expect(route.request().method()).toBe('POST')
    requests++
    if (requests === 2) await renewal
    return signedIn
      ? route.fulfill({ json: { accountId: 'sample-account', token: 'fixture-token', expiresIn: 3600 } })
      : route.fulfill({ status: 401, json: {} })
  })
  await page.goto('/tai-hub/')
  const ready = page.getByRole('banner').getByRole('button', { name: 'Añadir recurso', exact: true })
  await expect(ready).toBeEnabled()
  await page.reload()
  try {
    await expect(page.getByText('Recuperando acceso a Drive…')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reconectar', exact: true })).toHaveCount(0)
  } finally {
    resume()
  }
  await expect(ready).toBeEnabled()
  expect(requests).toBe(2)
  expect(drive.redirectPrompts).toEqual([])

  drive.rejectNextAuthRequest()
  await page.getByRole('button', { name: 'Cuenta y ajustes' }).click()
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
  await expect.poll(() => requests).toBe(3)
  await expect(page.getByRole('button', { name: 'Actualizar', exact: true })).toBeEnabled()
  expect(drive.redirectPrompts).toEqual([])

  await page.getByRole('button', { name: 'Desconectar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Conectar Google Drive', exact: true })).toBeEnabled()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Conectar Google Drive', exact: true })).toBeEnabled()
  await expect(ready).toBeDisabled()
})

test('retries a temporary renewal outage without opening Google', async ({ page, context }) => {
  test.skip(process.env.VITE_DRIVE_SESSION !== 'managed', 'Requires the managed session build.')
  const drive = new DriveFixture()
  await drive.install(context)
  let requests = 0
  let unavailable = false
  await context.route('**/tai-hub/session/token', route => {
    requests++
    return unavailable ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: { accountId: 'sample-account', token: 'fixture-token', expiresIn: 3600 } })
  })
  await page.goto('/tai-hub/')
  const ready = page.getByRole('banner').getByRole('button', { name: 'Añadir recurso', exact: true })
  await expect(ready).toBeEnabled()
  unavailable = true
  await page.reload()
  await expect(page.getByText('Recuperando acceso a Drive…')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reconectar', exact: true })).toHaveCount(0)
  unavailable = false
  await expect(ready).toBeEnabled({ timeout: 10_000 })
  expect(requests).toBeGreaterThanOrEqual(3)
  expect(drive.redirectPrompts).toEqual([])
})

test('sends an offline answer once after renewal and restores it on a second device', async ({
  page, context, browser, browserName, baseURL,
}) => {
  test.skip(process.env.VITE_DRIVE_SESSION !== 'managed', 'Requires the managed session build.')
  const drive = new DriveFixture()
  drive.addLabPackage('lab-managed-sync', samplePackage())
  async function setup(device: BrowserContext) {
    await drive.install(device, browserName === 'webkit', baseURL)
    await device.route('**/tai-hub/session/token', route => route.fulfill({
      json: { accountId: 'sample-account', token: 'fixture-token', expiresIn: 3600 },
    }))
  }
  async function openExercise(device: Page) {
    await device.goto(baseURL + '/tai-hub/')
    await expect(device.getByRole('banner').getByRole('button', { name: 'Añadir recurso', exact: true })).toBeEnabled()
    const menu = device.getByRole('button', { name: 'Abrir navegación', exact: true })
    if (await menu.isVisible()) await menu.click()
    await device.getByRole('button', { name: 'Laboratorio TAI', exact: true }).click()
    await device.getByRole('button', { name: 'Cargar lecciones de Drive', exact: true }).click()
    await device.getByRole('button', { name: /Lección sintética/ }).click()
    const practice = device.getByRole('button', { name: 'Practicar', exact: true })
    if (await practice.isVisible()) await practice.click()
    await expect(device.getByRole('radio', { name: 'Válida', exact: true })).toBeEnabled()
  }
  await setup(context)
  await openExercise(page)
  const sync = page.getByRole('button', { name: 'Sincronizar progreso', exact: true })
  await expect(page.getByText('Sincronizado', { exact: true })).toBeVisible()
  await context.setOffline(true)
  await page.getByRole('radio', { name: 'Válida', exact: true }).check()
  await page.getByRole('button', { name: 'Comprobar respuesta', exact: true }).click()
  await expect(page.getByText('Respuesta correcta', { exact: true })).toBeVisible()
  expect(drive.labEvents().filter((event: any) => event.kind === 'attempt')).toHaveLength(0)
  drive.rejectNextAuthRequest()
  await context.setOffline(false)
  await expect(sync).toBeEnabled()
  await expect.poll(() => drive.labEvents().filter((event: any) => event.kind === 'attempt').length).toBe(1)

  const other = await browser.newContext()
  try {
    await setup(other)
    const otherPage = await other.newPage()
    await openExercise(otherPage)
    await expect(otherPage.getByText('Respuesta correcta', { exact: true })).toBeVisible()
    expect(drive.labEvents().filter((event: any) => event.kind === 'attempt')).toHaveLength(1)
    expect(drive.redirectPrompts).toEqual([])
  } finally { await other.close() }
})
