import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const privateFile = /\.(pdf|zip|mp4|mov|mkv|m4v|webm|avi|mp3|aac|flac|epub|docx?|xlsx?|pptx?|csv)$/i
const privateDirectory = /(^|\/)(private|imports|originales|test-results)(\/|$)/i
const privateDocument = /<meta\b[^>]*\bname=["']tai-hub-private["']/i
const sensitiveValue = /(?:GOCSPX-[a-zA-Z0-9_-]{15,}|ya29\.[a-zA-Z0-9_-]{20,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/
const tracked = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean))]
const publication = process.argv[2] ?? 'dist'
// Public interpreter dependency, not a study archive. Keep the exception scoped to this exact pinned artifact.
const pythonStdlibHash = 'fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a'

function checkName(path) {
  if (privateFile.test(path) || privateDirectory.test(path) || /(^|\/)\.env(?!\.example$)/.test(path)) {
    throw new Error('Ruta de datos privados en el árbol público.')
  }
}

async function checkFile(path) {
  if (dirname(resolve(path)) === resolve(publication, 'assets') && /\/python_stdlib-[a-zA-Z0-9_-]+\.zip$/.test(path)) {
    if (createHash('sha256').update(await readFile(path)).digest('hex') !== pythonStdlibHash) throw new Error('El archivo público de Python no coincide con la dependencia revisada.')
    return
  }
  checkName(path)
  if (/\.(tsx?|m?js|html|css|json|ya?ml|txt|md|svg|map)$/i.test(path)) {
    const content = await readFile(path, 'utf8')
    if (privateDocument.test(content)) throw new Error('Documento personal de estudio en el árbol público.')
    if (/\.json$/i.test(path) && /"privacy"\s*:\s*"tai-lab-private"/.test(content)) {
      throw new Error('Paquete o progreso privado del laboratorio en el árbol público.')
    }
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
await checkDirectory(publication)
console.log('Árbol Git y archivos de publicación revisados.')
