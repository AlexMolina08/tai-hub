import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { readerScript } from './html-reader-script'

test('the parent CSP permits exactly the application-owned reader helper', () => {
  const index = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const hash = createHash('sha256').update(readerScript).digest('base64')
  expect(index).toContain(`'sha256-${hash}'`)
  const scriptPolicy = index.match(/script-src ([^;]+)/)?.[1]
  expect(scriptPolicy).not.toContain("'unsafe-inline'")
})
