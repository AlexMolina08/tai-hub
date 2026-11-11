import { code } from 'virtual:lab-python'
import wasmUrl from 'pyodide/pyodide.asm.wasm?url'
import stdlibUrl from 'pyodide/python_stdlib.zip?url'
import lockUrl from 'pyodide/pyodide-lock.json?url'

let cached: Promise<{ code: string; wasm: ArrayBuffer; stdlib: ArrayBuffer; lock: string }> | undefined
export function pythonAssets() {
  cached ??= Promise.all([wasmUrl, stdlibUrl, lockUrl].map(async url => {
    const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error('No se pudo descargar Python. Comprueba la conexión o la descarga sin conexión.')
    return response.arrayBuffer()
  })).then(([wasm, stdlib, lock]) => ({ code, wasm, stdlib, lock: new TextDecoder().decode(lock) }))
    .catch(error => { cached = undefined; throw error })
  return cached
}
