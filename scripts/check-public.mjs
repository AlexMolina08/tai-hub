import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const privateFile = /\.(pdf|zip|mp4|mov|mkv|m4v|webm|avi|mp3|aac|flac|epub|docx?|xlsx?|pptx?|csv)$/i
const privateDirectory = /(^|\/)(private|imports|originales|test-results)(\/|$)/i
const sensitiveValue = /(?:GOCSPX-[a-zA-Z0-9_-]{15,}|ya29\.[a-zA-Z0-9_-]{20,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)

function checkName(path) {
  if (privateFile.test(path) || privateDirectory.test(path) || /(^|\/)\.env(?!\.example$)/.test(path)) {
    throw new Error('Ruta de datos privados en el árbol público.')
  }
}

async function checkFile(path) {
  checkName(path)
  if (/\.(tsx?|m?js|html|css|json|ya?ml|txt|md|svg|map)$/i.test(path)) {
    const content = await readFile(path, 'utf8')
    if (sensitiveValue.test(content)) throw new Error('Posible credencial en el árbol público.')
  }
}

async function checkDirectory(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    if (item.isDirectory()) await checkDirectory(path)
    else if (item.isFile()) await checkFile(path)
    else throw new Error('Entrada inesperada en el despliegue público.')
  }
}

await Promise.all(tracked.map(checkFile))
await checkDirectory('dist')
console.log('Árbol Git y dist revisados.')
