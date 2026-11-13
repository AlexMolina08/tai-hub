import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Attempt, SqlActivity } from './model'
import { compareSqlResults } from './sql-comparison'
import type { SqlResult } from './sql-runner'
import { EditorOutput, EditorWorkspace } from './EditorWorkspace'

const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.'

export function SqlPanel({ activity, saved, latest, disabled, save, onResult, focusPrompt }: {
  activity: SqlActivity; saved: string; latest?: Attempt; disabled: boolean; save: (value: string) => Promise<void>
  onResult: (value: string, correct: boolean, feedback?: string) => Promise<void>; focusPrompt?: ReactNode
}) {
  const [query, setQuery] = useState(saved)
  useEffect(() => { setQuery(saved) }, [saved])
  const [output, setOutput] = useState<{ query: string; result: SqlResult }>()
  const result = output?.query === query ? output.result : undefined
  const [executionStatus, setExecutionStatus] = useState<{ query: string; text: string }>()
  const setStatus = (text: string) => setExecutionStatus({ query, text })
  const status = executionStatus?.query === query ? executionStatus.text : latest?.answer === query ? latest.feedback : ''
  const [running, setRunning] = useState(false)
  const controller = useRef<AbortController>(undefined)
  useEffect(() => () => controller.current?.abort(), [])

  async function execute(check: boolean) {
    setRunning(true)
    setStatus('Preparando el motor SQL…')
    setOutput(undefined)
    const { signal } = controller.current = new AbortController()
    try {
      await save(query)
      const { runSql } = await import('./sql-runner')
      setStatus(check ? 'Comprobando varios conjuntos de datos…' : 'Ejecutando consulta…')
      let correct = true
      for (const [i, dataset] of activity.datasets.entries()) {
        const actual = await runSql(dataset.setup, query, signal)
        if (i === 0) setOutput({ query, result: actual })
        if (!check) break
        const expected = await runSql(dataset.setup, activity.referenceQuery, signal)
        correct = correct && compareSqlResults(actual, expected, activity.comparison)
      }
      if (check) await onResult(query, correct)
      setStatus(check ? correct ? 'Correcta en los casos comprobados.' : 'Revisa la consulta: algún caso produce otro resultado.' : 'Consulta ejecutada. Puedes modificarla o comprobarla.')
    } catch (failure) {
      if (check && failure instanceof Error && failure.name === 'SqlQueryError') {
        try { await onResult(query, false, failure.message) }
        catch (saving) { setStatus(message(saving)); return }
      }
      setStatus(message(failure))
    } finally { setRunning(false) }
  }

  function edit(value: string) {
    setQuery(value)
    void save(value).catch(() => {})
  }

  return <EditorWorkspace name="Editor SQL" prompt={focusPrompt}>
    <div className="lab-editor-layout">
      <div className="lab-editor-fields">
        <details><summary>Tablas y datos iniciales</summary><pre>{activity.datasets[0].setup}</pre></details>
        <label htmlFor={`query-${activity.id}`}>Consulta SQL</label>
        <textarea id={`query-${activity.id}`} value={query} rows={8} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          disabled={running || disabled} onChange={event => edit(event.target.value)}
          onBlur={() => { if (query !== saved) void save(query).catch(() => {}) }} />
        <div className="lab-actions">
          <button className="button" disabled={running || disabled} onClick={() => void execute(false)}>Ejecutar SQL</button>
          <button className="button primary" disabled={running || disabled} onClick={() => void execute(true)}>Comprobar SQL</button>
          {running && <button className="button" onClick={() => controller.current?.abort()}>Cancelar ejecución</button>}
        </div>
        <p role="status">{status}</p>
      </div>
      {result && <EditorOutput title="Resultado" long={result.rows.length > 6 || result.columns.length > 3}>
        <div className="lab-sql-table" tabIndex={0} role="region" aria-label="Resultado de la consulta">
          <table>
            <thead><tr>{result.columns.map((column, i) => <th key={i} scope="col">{column}</th>)}</tr></thead>
            <tbody>{result.rows.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j}>{value === null ? 'NULL' : String(value)}</td>)}</tr>)}</tbody>
          </table>
          <p>{result.rows.length} {result.rows.length === 1 ? 'fila' : 'filas'}.</p>
        </div>
      </EditorOutput>}
    </div>
    <button className="text-link lab-editor-reset" disabled={running || disabled}
      onClick={() => { edit(activity.starter); setOutput(undefined); setExecutionStatus(undefined) }}>Restablecer consulta</button>
  </EditorWorkspace>
}
