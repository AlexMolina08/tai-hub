import { useEffect, useRef, useState } from 'react'
import type { CodeActivity } from './model'
import type { ProgramResult } from './program-runner'

export function CodePanel({ activity, saved, disabled, save, onResult }: {
  activity: CodeActivity; saved: string; disabled: boolean; save: (value: string) => Promise<void>;
  onResult: (value: string, correct: boolean, feedback: string) => Promise<void>
}) {
  const [source, setSource] = useState(saved)
  const [result, setResult] = useState<ProgramResult>()
  const [status, setStatus] = useState('')
  const [running, setRunning] = useState(false)
  const controller = useRef<AbortController>(undefined)
  useEffect(() => () => controller.current?.abort(), [])
  const error = (failure: unknown) => setStatus(failure instanceof Error ? failure.message : 'No se pudo completar la ejecución.')
  async function execute(check: boolean) {
    setRunning(true); setStatus('Preparando el motor…'); setResult(undefined)
    controller.current = new AbortController()
    try {
      await save(source)
      const { runProgram } = await import('./program-runner')
      let correct = true
      let feedback = ''
      for (const [i, dataset] of activity.datasets.entries()) {
        const actual = await runProgram(activity.language, source, dataset.input, controller.current.signal,
          text => setStatus(check ? `Caso ${i + 1} de ${activity.datasets.length}. ${text}` : text))
        if (i === 0) setResult(actual)
        if (!check) { setStatus(actual.error ?? 'Código ejecutado. Puedes modificarlo o comprobarlo.'); return }
        const matches = actual.status === 'done' && JSON.stringify(actual.output) === JSON.stringify(dataset.expectedOutput)
        correct = correct && matches
        if (!matches && !feedback) feedback = actual.error ?? `El caso ${i + 1} produce otra salida. Revisa también los casos límite.`
        if (actual.status !== 'done') break
      }
      feedback = correct ? 'El código satisface los casos comprobados.' : feedback
      await onResult(source, correct, feedback)
      setStatus(correct ? 'Correcto en los casos comprobados.' : feedback)
    } catch (failure) { error(failure) }
    finally { setRunning(false) }
  }
  return <div className="lab-code lab-sql">
    <details><summary>Entrada del primer caso</summary><p>Disponible en la variable <code>input</code>. Muestra el resultado con {activity.language === 'python' ? 'print' : 'console.log'}.</p>
      <pre>{JSON.stringify(activity.datasets[0].input, null, 2)}</pre></details>
    <label htmlFor={`code-${activity.id}`}>Código {activity.language === 'python' ? 'Python' : 'JavaScript'}</label>
    <textarea id={`code-${activity.id}`} value={source} rows={9} spellCheck={false} autoCapitalize="off" autoCorrect="off"
      disabled={running || disabled} onChange={e => { setSource(e.target.value); void save(e.target.value).catch(error) }} />
    <div className="lab-actions">
      <button className="button" disabled={running || disabled} onClick={() => void execute(false)}>Ejecutar código</button>
      <button className="button primary" disabled={running || disabled} onClick={() => void execute(true)}>Comprobar código</button>
      <button className="button" disabled={running || disabled} onClick={() => { setSource(activity.starter); void save(activity.starter).catch(error); setResult(undefined); setStatus('') }}>Restablecer código</button>
      {running && <button className="button" onClick={() => controller.current?.abort()}>Cancelar ejecución</button>}
    </div>
    <p role="status">{status}</p>
    {result && <section aria-label="Salida del programa"><pre>{result.output.join('\n') || 'Sin salida.'}</pre></section>}
  </div>
}
