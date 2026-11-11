import { useEffect, useState } from 'react'
import type { Attempt, FrameModelActivity } from './model'
import { describeFrame, frameControls, matchesFrameAnswer, parseFrameDraft, validFrameAnswer } from './frame-model'

export function FramePanel({ activity, saved, latest, disabled, save, onResult }: {
  activity: FrameModelActivity; saved: string; latest?: Attempt; disabled: boolean
  save: (value: string) => Promise<void>
  onResult: (value: string, correct: boolean, feedback: string) => Promise<void>
}) {
  const profile = activity.profile
  const [draft, setDraft] = useState(() => parseFrameDraft(saved, profile))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setDraft(parseFrameDraft(saved, profile)) }, [saved, profile])
  const controls = frameControls(profile)
  const exercise = describeFrame(profile, draft.controls)
  const serialized = JSON.stringify(draft)
  const graded = latest?.answer === serialized && latest.outcome !== 'omitted'
  const locked = disabled || busy
  const complete = exercise.answers.every((answer, i) => validFrameAnswer(answer, draft.answers[i]))

  function edit(next: typeof draft) {
    setDraft(next); setError('')
    void save(JSON.stringify(next)).catch(() => {}) // Shared draft controls own recovery.
  }
  function changeControl(index: number, value: string) {
    const next = draft.controls.map((entry, i) => i === index ? value : entry)
    edit({ controls: next, answers: describeFrame(profile, next).answers.map(() => '') })
  }
  async function submit() {
    setBusy(true); setError('')
    try {
      await save(serialized)
      const correct = exercise.answers.every((answer, i) => matchesFrameAnswer(answer, draft.answers[i]))
      await onResult(serialized, correct, correct ? 'Predicción correcta.' : 'Revisa tu predicción con el cálculo.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar la comprobación.')
    } finally { setBusy(false) }
  }
  return <div className="lab-frame">
    <fieldset disabled={locked} className="lab-frame-section">
      <legend>Parámetros</legend>
      <div className="lab-model-fields">
        {controls.map((control, index) => control.toggle
          ? <label key={control.label} className="lab-frame-toggle">
            <input type="checkbox" checked={draft.controls[index] === '1'}
              onChange={event => changeControl(index, event.target.checked ? '1' : '0')} />
            {control.label}
          </label>
          : <label key={control.label}>{control.label}
            <select value={draft.controls[index]} onChange={event => changeControl(index, event.target.value)}>
              {control.options.map(option => <option key={option}>{option}</option>)}
            </select>
          </label>)}
      </div>
    </fieldset>
    <ul>{exercise.facts.map(fact => <li key={fact}>{fact}</li>)}</ul>
    <fieldset disabled={locked} className="lab-frame-section">
      <legend>Tu predicción</legend>
      <div className="lab-model-fields">
        {exercise.answers.map(({ label, options, format }, index) => {
          const update = (value: string) => edit({ ...draft, answers: draft.answers.map((entry, i) => i === index ? value : entry) })
          return <label key={label}>{label}
            {options ? <select value={draft.answers[index]} onChange={event => update(event.target.value)}>
              <option value="">Elige una opción</option>
              {options.map(option => <option key={option}>{option}</option>)}
            </select> : <input type="text" inputMode={format === 'integer' ? 'numeric' : 'text'} autoComplete="off"
              spellCheck={false} maxLength={40} value={draft.answers[index]} onChange={event => update(event.target.value)} />}
          </label>
        })}
      </div>
    </fieldset>
    <div className="lab-actions">
      <button className="button primary" disabled={locked || !complete} onClick={() => void submit()}>Comprobar predicción</button>
      <button className="button" disabled={locked} onClick={() => edit(parseFrameDraft('', profile))}>Restablecer práctica</button>
    </div>
    <p role="status">{busy ? 'Guardando la comprobación…' : graded ? latest.feedback : ''}</p>
    {graded && <section aria-label="Cálculo de la configuración" className="lab-feedback">
      <ul>{exercise.answers.map((answer, i) => <li key={answer.label}>
        <strong>{answer.label}</strong> · {matchesFrameAnswer(answer, draft.answers[i]) ? 'Correcta' : 'Revisar'}. Resultado: {answer.expected}.
      </li>)}</ul>
      {exercise.steps.map(step => <p key={step}>{step}</p>)}
      {exercise.points && <div className="lab-constellation" aria-hidden="true">
        {[3, 1, -1, -3].flatMap(q => [-3, -1, 1, 3].map(i => {
          const points = exercise.points!.map(([x, y], index) => x === i && y === q ? 'AB'[index] : '').join('')
          return <span key={`${i}/${q}`}>{points || '·'}</span>
        }))}
      </div>}
    </section>}
    {error && <p role="alert">{error}</p>}
  </div>
}
