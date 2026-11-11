import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const [path, mode = 'study'] = process.argv.slice(2)
if (!path || !['study', 'authoring'].includes(mode)) {
  console.error('Uso: npm run lab:validate -- /ruta/privada/paquete.json [study|authoring]')
  process.exitCode = 2
} else {
  // Bundle only the validator. Input documents stay outside the source tree and build output.
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/lab/validate.ts', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm' })
  const { parsePackage } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'))
  try {
    const pack = parsePackage(JSON.parse(await readFile(path, 'utf8')), mode)
    console.log(JSON.stringify({ mode, packageId: pack.id, version: pack.version,
      objectives: pack.objectives.length, lessons: pack.lessons.length, activities: pack.activities.length,
      validatedObjectives: pack.objectives.filter(o => o.state === 'validated').length }))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Validación fallida')
    process.exitCode = 1
  }
}
