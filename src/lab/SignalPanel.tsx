import { useEffect, useState } from 'react'
import type { Attempt, SignalModelActivity } from './model'
import { describeSignalCase, parseSignalAnswers, signalAnswerMatches, signalAnswersComplete } from './signal-model'

export function SignalPanel({ activity, saved, latest, disabled, save, onResult }: {
  activity: SignalModelActivity; saved: string; latest?: Attempt; disabled: boolean
  save: (value: string) => Promise<void>
  onResult: (value: string, correct: boolean, feedback: string) => Promise<void>
}) {
  const [answers, setAnswers] = useState(() => parseSignalAnswers(saved, activity.cases))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setAnswers(parseSignalAnswers(saved, activity.cases)) }, [saved, activity.cases])
  const cases = activity.cases.map(describeSignalCase)
  const serialized = JSON.stringify(answers)
  const graded = latest?.answer === serialized && latest.outcome !== 'omitted'
  const locked = disabled || busy
  const complete = signalAnswersComplete(activity.cases, answers)

  function edit(next: string[][]) {
    setAnswers(next); setError('')
    void save(JSON.stringify(next)).catch(() => {}) // Shared draft controls surface failures and preserve the revision.
  }
  async function submit() {
    setBusy(true); setError('')
    try {
      await save(serialized)
      const correct = cases.every((item, i) => item.fields.every((field, j) => signalAnswerMatches(field, answers[i][j])))
      await onResult(serialized, correct, correct ? 'Has acertado en ambas configuraciones.' : 'Compara tus respuestas con el resultado de cada configuración.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar la comprobación.') }
    finally { setBusy(false) }
  }
  return <div className="lab-signal">
    {activity.cases[0].kind !== 'transmission' && <p>Usa las unidades indicadas. Redondea al final a dos decimales como máximo. Puedes usar coma o punto decimal.</p>}
    {cases.map(({ facts, fields }, index) => <fieldset key={activity.cases[index].id} disabled={locked}>
      <legend>{activity.cases[index].title}</legend>
      <ul>{facts.map(fact => <li key={fact}>{fact}</li>)}</ul>
      <div className="lab-model-fields">
        {fields.map(({ label, options }, fieldIndex) => {
          const update = (value: string) => edit(answers.map((entries, i) => i === index
            ? entries.map((entry, j) => j === fieldIndex ? value : entry) : entries))
          return <label key={label}>{label}
            {options ? <select value={answers[index][fieldIndex]} onChange={event => update(event.target.value)}>
              <option value="">Elige una opción</option>
              {options.map(option => <option key={option}>{option}</option>)}
            </select> : <input type="text" inputMode="decimal" autoComplete="off" maxLength={40}
              value={answers[index][fieldIndex]} onChange={event => update(event.target.value)} />}
          </label>
        })}
      </div>
      {graded && <ul className="lab-signal-comparison" aria-label={`Corrección de ${activity.cases[index].title}`}>
        {fields.map((field, j) => <li key={field.label}>
          <strong>{field.label} · {signalAnswerMatches(field, answers[index][j]) ? 'Correcta' : 'Revisar'}</strong>
          <p>Resultado: {field.options ? field.expected : field.expected.replace('.', ',')}. {field.explanation}</p>
        </li>)}
      </ul>}
    </fieldset>)}
    <div className="lab-actions">
      <button className="button primary" disabled={locked || !complete} onClick={() => void submit()}>Comprobar los dos casos</button>
      <button className="button" disabled={locked} onClick={() => edit(parseSignalAnswers('', activity.cases))}>Restablecer respuestas</button>
    </div>
    <p role="status">{busy ? 'Guardando la comprobación…' : graded ? latest.feedback : ''}</p>
    {error && <p role="alert">{error}</p>}
  </div>
}
