import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DriveFixture } from './fixtures'
import { blocks } from '../src/syllabus'

// Opt-in validation of private artifacts. No study document enters the source tree.
const directory = process.env.TAI_PRIVATE_NOTES_DIR
const files = directory ? readdirSync(directory).filter(name => /^b[1-4]t\d+-apuntes-ampliados\.html$/.test(name)).sort() : []
for (const file of files) {
  test(`private document ${file}: content, anchors, images, mobile layout`, async ({ page, context }) => {
    const drive = new DriveFixture()
    const topicId = file.split('-')[0]
    const source = readFileSync(join(directory!, file), 'utf8')
    expect(source).toContain('<meta name="tai-hub-edition" content="integrated">')
    drive.addHtml('private-document', 'Apuntes ampliados de validación', source, topicId)
    await drive.install(context)
    await page.goto('/tai-hub/')
    expect(drive.mediaReads).not.toContain('private-document')
    await page.getByRole('button', { name: 'Conectar Google Drive', exact: true }).click()
    const block = blocks.find(item => item.topics.some(topic => topic.id === topicId))!
    const topic = block.topics.find(item => item.id === topicId)!
    await page.locator('main .block-card').filter({ hasText: block.title }).click()
    await page.locator('.topic-list button').filter({ hasText: topic.title }).click()
    await page.getByRole('button', { name: 'Apuntes ampliados', exact: true }).click()
    const frame = page.frameLocator('iframe[title="Apuntes ampliados de validación"]')
    await expect(frame.locator('h1')).toBeVisible()
    const expectedText = await page.evaluate(input => {
      const document = new DOMParser().parseFromString(input, 'text/html')
      return document.querySelector('#base')!.textContent!.replace(/\s+/g, ' ').trim()
    }, source)
    const displayedText = await frame.locator('#base').evaluate(element => {
      const copy = element.cloneNode(true) as HTMLElement
      copy.querySelectorAll('button.copy-code').forEach(button => button.remove())
      return copy.textContent!.replace(/\s+/g, ' ').trim()
    })
    expect(displayedText).toBe(expectedText)
    expect(await frame.locator('[id^="pdf-p"]').count()).toBeGreaterThan(10)
    expect(await frame.locator('#base .ampliacion, #base .correccion, #base .context-links').count()).toBe(0)
    expect(await frame.locator('#base pre').evaluateAll(elements => elements.filter(element => /^●\s*●\s*●[^\n]*$/.test(element.textContent!.trim())).length)).toBe(0)
    expect(await frame.locator('#base details.sources').evaluateAll(elements => elements.filter(element =>
      element.querySelector('summary')?.textContent?.startsWith('Referencia de examen recogida en el manual') && element.querySelector('pre')
    ).length)).toBe(0)
    const transcripts = frame.locator('#base pre.terminal-transcript')
    if (await transcripts.count()) {
      expect(await transcripts.evaluateAll(elements => elements.every(element => !element.closest('details') && !!element.getAttribute('data-copy')))).toBe(true)
    }
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
    if (await transcripts.count()) {
      const redirection = transcripts.filter({ hasText: 'echo "2026" >> fichero' }).first()
      await redirection.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
      await expect(redirection).toBeInViewport()
      await page.screenshot({ path: test.info().outputPath(`${topicId}-comandos.png`) })
    }
    await frame.locator('nav a').first().click()
    await expect(frame.locator('#base h2').first()).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath(`${topicId}-base.png`) })
    const navigation = frame.locator('nav a')
    const middle = navigation.nth(Math.floor((await navigation.count()) / 2))
    await middle.click()
    const middleId = (await middle.getAttribute('href'))!.slice(1)
    await expect(frame.locator(`[id="${middleId}"]`)).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath(`${topicId}-contenido.png`) })
    await frame.locator('nav a[href="#exam-evidence"]').click()
    await expect(frame.locator('#exam-evidence > h2')).toBeInViewport()
    await frame.getByText('Preguntas históricas clasificadas', { exact: true }).click()
    await expect(frame.locator('#evidencia-examenes')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath(`${topicId}-fuentes.png`) })
    const zoom = frame.locator('button.image-zoom:visible').first()
    if (await zoom.count()) {
      await zoom.click()
      await expect(frame.getByRole('button', { name: 'Ajustar imagen', exact: true }).first()).toHaveAttribute('aria-pressed', 'true')
      expect(await frame.locator('body').evaluate(body => body.scrollWidth <= body.ownerDocument.documentElement.clientWidth + 1)).toBe(true)
      await frame.locator('.image-viewport:visible').first().evaluate(element => element.scrollIntoView())
      await page.screenshot({ path: test.info().outputPath(`${topicId}-imagen.png`) })
      await frame.getByRole('button', { name: 'Ajustar imagen', exact: true }).first().click()
    }
    const code = frame.locator('pre:visible').first()
    if (await code.count()) {
      const button = frame.locator('button.copy-code:visible').filter({ hasText: /^Copiar código$/ }).first()
      await button.click()
      await expect(frame.getByRole('button', { name: /Copiado|Código seleccionado/ }).first()).toBeVisible()
    }
  })
}
