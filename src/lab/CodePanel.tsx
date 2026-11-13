import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Attempt, CodeActivity } from './model'
import type { ProgramResult } from './program-runner'
import { EditorOutput, EditorWorkspace } from './EditorWorkspace'

export function CodePanel({ activity, saved, latest, disabled, save, onResult, focusPrompt }: {
  activity: CodeActivity; saved: string; disabled: boolean; save: (value: string) => Promise<void>;
  onResult: (value: string, correct: boolean, feedback: string) => Promise<void>; latest?: Attempt; focusPrompt?: ReactNode
}) {
  const [source, setSource] = useState(saved)
  useEffect(() => { setSource(saved) }, [saved])
  const [output, setOutput] = useState<{ source: string; result: ProgramResult }>()
  const result = output?.source === source ? output.result : undefined
  const [executionStatus, setExecutionStatus] = useState<{ source: string; text: string }>()
  const setStatus = (text: string) => setExecutionStatus({ source, text })
  const status = executionStatus?.source === source ? executionStatus.text : latest?.answer === source ? latest.feedback : ''
  const [running, setRunning] = useState(false)
  const controller = useRef<AbortController>(undefined)
  useEffect(() => () => controller.current?.abort(), [])
  const error = (failure: unknown) => setStatus(failure instanceof Error ? failure.message : 'No se pudo completar la ejecución.')
  // The parent buffer displays autosave failures and owns their retry/copy controls across navigation.
  async function execute(check: boolean) {
    setRunning(true); setStatus('Preparando el motor…'); setOutput(undefined)
    const { signal } = controller.current = new AbortController()
    try {
      await save(source)
      const { runProgram } = await import('./program-runner')
      let correct = true
      let feedback = ''
      for (const [i, dataset] of activity.datasets.entries()) {
        const actual = await runProgram(activity.language, source, dataset.input, signal,
          text => setStatus(check ? `Caso ${i + 1} de ${activity.datasets.length}. ${text}` : text))
        if (i === 0) setOutput({ source, result: actual })
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
  function edit(value: string) {
    setSource(value)
    void save(value).catch(() => {})
  }
  const language = activity.language === 'python' ? 'Python' : 'JavaScript'
  return <EditorWorkspace name={`Editor ${language}`} className="lab-code" prompt={focusPrompt}>
    <div className="lab-editor-layout">
      <div className="lab-editor-fields">
        <details><summary>Entrada del primer caso</summary><p>Disponible en la variable <code>input</code>. Muestra el resultado con {activity.language === 'python' ? 'print' : 'console.log'}.</p>
          <pre>{JSON.stringify(activity.datasets[0].input, null, 2)}</pre></details>
        <label htmlFor={`code-${activity.id}`}>Código {language}</label>
        <textarea id={`code-${activity.id}`} value={source} rows={9} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          disabled={running || disabled} onChange={event => edit(event.target.value)} />
        <div className="lab-actions">
          <button className="button" disabled={running || disabled} onClick={() => void execute(false)}>Ejecutar código</button>
          <button className="button primary" disabled={running || disabled} onClick={() => void execute(true)}>Comprobar código</button>
          {running && <button className="button" onClick={() => controller.current?.abort()}>Cancelar ejecución</button>}
        </div>
        <p role="status">{status}</p>
      </div>
      {result && <EditorOutput title="Salida" long={result.output.length > 6 || result.output.join('\n').length > 320}>
        <section aria-label="Salida del programa"><pre>{result.output.join('\n') || 'Sin salida.'}</pre></section>
      </EditorOutput>}
    </div>
    <button className="text-link lab-editor-reset" disabled={running || disabled}
      onClick={() => { edit(activity.starter); setOutput(undefined); setExecutionStatus(undefined) }}>Restablecer código</button>
  </EditorWorkspace>
}
