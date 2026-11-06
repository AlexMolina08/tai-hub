import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { DriveFixture } from './fixtures'

const sample = `<!doctype html><html><head><style>
body{padding:18px}h2{margin-top:80vh}.table-wrap{overflow:auto}table{min-width:700px}
</style></head><body><h1>Apuntes de prueba</h1><nav><a href="#normalizacion">Normalización</a></nav>
<h2 id="normalizacion">Dependencias funcionales</h2><p>Texto seleccionable del documento privado.</p>
<div class="table-wrap"><table><tr><th>Clave</th><th>Dependencia</th></tr><tr><td>A</td><td>A → B</td></tr></table></div>
<pre><code>SELECT 1;</code></pre><img alt="Diagrama de prueba" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=">
<script>parent.document.body.dataset.privateScript='executed'</script>
<img src="https://private-leak.invalid/image" onerror="parent.document.body.dataset.privateScript='executed'">
<meta http-equiv="refresh" content="0;url=https://private-leak.invalid/refresh">
<iframe src="https://private-leak.invalid/frame"></iframe><form action="https://private-leak.invalid/form"><button>Enviar</button></form>
<a href="javascript:alert(1)">Enlace inseguro</a></body></html>`

test('reads private HTML with navigation, selectable text and contained tables; blocks active content', async ({ page, context }) => {
  const drive = new DriveFixture()
  const content = process.env.TAI_PRIVATE_HTML ? await readFile(process.env.TAI_PRIVATE_HTML, 'utf8') : sample
  drive.addHtml('private-notes', 'Apuntes ampliados de prueba', content)
  await drive.install(context)
  const leaks: string[] = []
  page.on('request', request => { if (request.url().includes('private-leak.invalid')) leaks.push(request.url()) })
  await page.goto('/tai-hub/')
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(drive.mediaReads).not.toContain('private-notes')
  await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
  await page.getByRole('textbox', { name: 'Buscar en la biblioteca' }).fill('Apuntes ampliados de prueba')
  await page.getByRole('button', { name: /Apuntes ampliados de prueba III.1/ }).click()
  const frame = page.frameLocator('iframe[title="Apuntes ampliados de prueba"]')
  await expect(frame.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(frame.locator('table').first()).toBeAttached()
  expect(await frame.locator('body').evaluate(body => body.scrollWidth <= body.ownerDocument.documentElement.clientWidth + 1)).toBe(true)
  expect(await page.locator('body').getAttribute('data-private-script')).toBeNull()
  expect(leaks).toEqual([])
  await expect(frame.locator('script:not(#tai-reader-helper),iframe,form,meta[http-equiv="refresh"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Lectura amplia', exact: true }).click()
  await expect(page.locator('.html-reader-expanded')).toBeVisible()
  const firstAnchor = frame.locator('nav a[href^="#"]').first()
  await firstAnchor.click()
  const targetId = (await firstAnchor.getAttribute('href'))!.slice(1)
  await expect.poll(() => frame.locator(`[id="${targetId}"]`).evaluate(element => {
    const doc = element.ownerDocument
    const top = element.getBoundingClientRect().top
    return top >= -2 && top < doc.documentElement.clientHeight && (doc.scrollingElement?.scrollTop ?? 0) > 0
  })).toBe(true)
  expect(await page.locator('iframe').getAttribute('sandbox')).not.toContain('allow-same-origin')
  if (!process.env.TAI_PRIVATE_HTML) {
    await expect(frame.getByRole('button', { name: 'Copiar código' })).toBeVisible()
    await frame.getByRole('button', { name: 'Copiar código' }).click()
    await expect(frame.getByRole('button', { name: /Copiado|Código seleccionado/ })).toBeVisible()
  }
  const brokenImages = await frame.locator('img[src]').evaluateAll(images => images.filter(image => (image as HTMLImageElement).complete && !(image as HTMLImageElement).naturalWidth).length)
  expect(brokenImages).toBe(0)
  const firstImage = frame.locator('img[src]').first()
  const initialWidth = await firstImage.evaluate(image => image.getBoundingClientRect().width)
  await frame.getByRole('button', { name: 'Ampliar imagen', exact: true }).first().click()
  await expect(frame.getByRole('button', { name: 'Ajustar imagen', exact: true }).first()).toHaveAttribute('aria-pressed', 'true')
  expect(await firstImage.evaluate(image => image.getBoundingClientRect().width)).toBeGreaterThan(initialWidth)
  expect(await frame.locator('body').evaluate(body => body.scrollWidth <= body.ownerDocument.documentElement.clientWidth + 1)).toBe(true)
  await frame.getByRole('button', { name: 'Ajustar imagen', exact: true }).first().click()
  expect(await firstImage.evaluate(image => image.getBoundingClientRect().width)).toBeCloseTo(initialWidth, 0)
  await page.screenshot({ path: test.info().outputPath('html-reader.png'), fullPage: true })
  await page.getByRole('button', { name: 'Salir de lectura amplia' }).click()
  await page.getByRole('button', { name: 'Cuenta y ajustes' }).click()
  await page.getByRole('button', { name: 'Desconectar', exact: true }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('iframe')).toHaveCount(0)
})
