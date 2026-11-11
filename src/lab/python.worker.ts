import { loadPyodide } from 'pyodide'
import createPyodideModule from 'pyodide/pyodide.asm.mjs'

const send = postMessage.bind(globalThis)
let lines = 0, bytes = 0
function output(text: string) {
  if (++lines > 100 || (bytes += text.length) > 16_000) {
    send({ kind: 'output-limit' })
    throw new Error('Salida limitada a 100 líneas o 16 KB.')
  }
  send({ kind: 'output', text })
}
addEventListener('message', async event => {
  const data = event.data
  try {
    // Supply the pinned assets in memory. CSP remains the network boundary even if user code restores native APIs.
    globalThis.fetch = async input => {
      if (String(input) === 'https://pyodide-assets.invalid/pyodide.asm.wasm') return new Response(data.wasm, { headers: { 'Content-Type': 'application/wasm' } })
      if (String(input) === 'https://pyodide-assets.invalid/python_stdlib.zip') return new Response(data.stdlib)
      throw new TypeError('Solo están disponibles los archivos del motor.')
    }
    const pyodide = await loadPyodide({ indexURL: 'https://pyodide-assets.invalid/', lockFileContents: data.lock,
      createPyodideModule, packages: [], stdout: output, stderr: output, stdin: () => null })
    globalThis.fetch = () => { throw new TypeError('El acceso a la red está desactivado.') }
    pyodide.globals.set('__lab_input_json', JSON.stringify(data.input))
    pyodide.runPython('import json\ninput = json.loads(__lab_input_json)\ndel __lab_input_json')
    send({ kind: 'running' })
    await pyodide.runPythonAsync(data.source)
    send({ kind: 'done' })
  } catch (error) {
    send({ kind: 'error', message: error instanceof Error ? error.message.slice(-1800) : 'Error de Python.' })
  }
}, { once: true })
