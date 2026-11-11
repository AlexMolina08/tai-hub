import { PGlite } from '@electric-sql/pglite'

let running = false
addEventListener('message', async event => {
  if (running) return
  running = true
  let db: PGlite | undefined
  let stage = 'setup'
  try {
    const { wasm, initdb, bundle, setup, query } = event.data
    if (!(wasm instanceof ArrayBuffer) || !(initdb instanceof ArrayBuffer) || !(bundle instanceof ArrayBuffer)
      || typeof setup !== 'string' || setup.length > 100_000 || typeof query !== 'string' || query.length > 20_000) {
      throw new Error('Entrada SQL fuera de los límites del laboratorio.')
    }
    db = await PGlite.create({ dataDir: 'memory://', pgliteWasmModule: await WebAssembly.compile(wasm),
      initdbWasmModule: await WebAssembly.compile(initdb), fsBundle: new Blob([bundle]),
      startParams: [...PGlite.defaultStartParams, '-c', 'statement_timeout=3000'] })
    await db.exec(setup)
    stage = 'query'
    const result = await db.query<unknown[]>(query, [], { rowMode: 'array' })
    const rows = result.rows.map(row => row.map(value => typeof value === 'bigint' ? value.toString() : value))
    const columns = result.fields.map(field => field.name)
    const columnTypes = result.fields.map(field => field.dataTypeID)
    if (rows.length > 200 || JSON.stringify({ rows, columns, columnTypes }).length > 100_000) {
      throw new Error('La salida supera 200 filas o 100 KB. Reduce el resultado.')
    }
    postMessage({ kind: 'result', rows, columns, columnTypes })
  } catch (error) {
    postMessage({ kind: 'error', stage, message: error instanceof Error ? error.message.slice(0, 2000) : 'Error de ejecución SQL.' })
  } finally { await db?.close() }
})
