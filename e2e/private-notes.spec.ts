import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DriveFixture } from './fixtures'

// Opt-in validation of private artifacts. No study document enters the source tree.
const directory = process.env.TAI_PRIVATE_NOTES_DIR
const files = directory ? readdirSync(directory).filter(name => /^b[1-4]t\d+-apuntes-ampliados\.html$/.test(name)).sort() : []
for (const file of files) {
  test(`private document ${file}: content, anchors, images, mobile layout`, async ({ page, context }) => {
    const drive = new DriveFixture()
    const topicId = file.split('-')[0]
    drive.addHtml('private-document', 'Apuntes ampliados de validación', readFileSync(join(directory!, file), 'utf8'), topicId)
    await drive.install(context)
    await page.goto('/tai-hub/')
    expect(drive.mediaReads).not.toContain('private-document')
    await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
    await page.getByRole('textbox', { name: 'Buscar en la biblioteca' }).fill('Apuntes ampliados de validación')
    await page.getByRole('button', { name: /Apuntes ampliados de validación/ }).click()
    const frame = page.frameLocator('iframe[title="Apuntes ampliados de validación"]')
    await expect(frame.locator('h1')).toBeVisible()
    expect(await frame.locator('.source-page').count()).toBeGreaterThan(10)
    await expect(frame.locator('#ampliaciones')).not.toContainText('Ampliaciones en elaboración')
    const missing = await frame.locator('a[href^="#"]').evaluateAll(anchors => anchors.map(a => a.getAttribute('href')!.slice(1)).filter(id => !document.getElementById(decodeURIComponent(id))))
    expect(missing).toEqual([])
    expect(await frame.locator('body').evaluate(body => body.scrollWidth <= body.ownerDocument.documentElement.clientWidth + 1)).toBe(true)
    expect(await frame.locator('img').evaluateAll(async elements => {
      const images = elements as HTMLImageElement[]
      images.forEach(image => { image.loading = 'eager' })
      await Promise.all(images.map(image => image.decode().catch(() => undefined)))
      return images.filter(image => !image.naturalWidth || !image.alt).length
    })).toBe(0)
    await page.getByRole('button', { name: 'Lectura amplia', exact: true }).click()
    await frame.locator('nav a[href="#base"]').click()
    await expect(frame.locator('#base > h2')).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath(`${topicId}-base.png`) })
    await frame.locator('#ampliaciones').evaluate(element => element.scrollIntoView())
    await expect(frame.locator('#ampliaciones > h2')).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath(`${topicId}-ampliacion.png`) })
    const code = frame.locator('pre').first()
    if (await code.count()) {
      const button = frame.getByRole('button', { name: 'Copiar código', exact: true }).first()
      await button.click()
      await expect(frame.getByRole('button', { name: /Copiado|Código seleccionado/ }).first()).toBeVisible()
    }
  })
}
