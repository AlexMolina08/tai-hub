import { useEffect, useMemo, useState } from 'react'
import type { Attempt, PredictionActivity } from './model'
import { describeFrame, frameControls } from './frame-model'
import { accessControls, describeAccess } from './access-model'
import { algorithmControls, describeAlgorithm } from './algorithm-model'
import { closureControls, describeClosure } from './closure-model'
import { describeRelation, relationControls } from './relation-model'
import { describeStack, stackControls } from './stack-model'
import { describeSwitching, switchingControls } from './switching-model'
import { matchesPredictionAnswer, parsePredictionDraft, predictionInputLimit, validPredictionAnswer } from './prediction'

export function predictionFor(activity: PredictionActivity) {
  switch (activity.kind) {
    case 'access-model':
      return { controls: accessControls(activity.profile), describe: (values: string[]) => describeAccess(activity.profile, values) }
    case 'relation-model':
      return { controls: relationControls(activity.profile), describe: (values: string[]) => describeRelation(activity.profile, values) }
    case 'stack-model':
      return { controls: stackControls, describe: describeStack }
    case 'closure-model':
      return { controls: closureControls(activity.profile), describe: (values: string[]) => describeClosure(activity.profile, values) }
    case 'algorithm-model':
      return { controls: algorithmControls(activity.profile), describe: (values: string[]) => describeAlgorithm(activity.profile, values) }
    case 'switching-model':
      return { controls: switchingControls(activity.profile), describe: (values: string[]) => describeSwitching(activity.profile, values) }
    case 'frame-model':
      return { controls: frameControls(activity.profile), describe: (values: string[]) => describeFrame(activity.profile, values) }
  }
}

export function PredictionPanel({ activity, saved, latest, disabled, save, onResult }: {
  activity: PredictionActivity; saved: string; latest?: Attempt; disabled: boolean
  save: (value: string) => Promise<void>
  onResult: (value: string, correct: boolean, feedback: string) => Promise<void>
}) {
  const { controls, describe } = useMemo(() => predictionFor(activity), [activity])
  const [draft, setDraft] = useState(() => parsePredictionDraft(saved, controls, describe))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setDraft(parsePredictionDraft(saved, controls, describe)) }, [saved, controls, describe])
  const exercise = describe(draft.controls)
  const serialized = JSON.stringify({ controls: draft.controls, answers: draft.answers })
  const graded = latest?.answer === serialized && latest.outcome !== 'omitted'
  const locked = disabled || busy
  const complete = exercise.answers.every((answer, i) => validPredictionAnswer(answer, draft.answers[i]))
  const step = draft.step ?? 0
  const manualStart = activity.kind === 'closure-model' ? activity.profile.attributes.length : controls.length

  function edit(next: typeof draft) {
    setDraft(next); setError('')
    void save(JSON.stringify(next)).catch(() => {}) // Shared draft controls own recovery.
  }
  function changeControl(index: number, value: string) {
    const resetFollowing = index >= manualStart && value === controls[index].initial
    const next = draft.controls.map((entry, i) => i === index ? value : resetFollowing && i > index ? controls[i].initial : entry)
    edit({ controls: next, answers: describe(next).answers.map(() => '') })
  }
  async function submit() {
    setBusy(true); setError('')
    try {
      await save(serialized)
      const correct = exercise.answers.every((answer, i) => matchesPredictionAnswer(answer, draft.answers[i]))
      await onResult(serialized, correct, correct ? 'Predicción correcta.' : 'Revisa tu predicción con el cálculo.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar la comprobación.')
    } finally { setBusy(false) }
  }
  return <div className={`lab-${activity.kind.replace('-model', '')}`}>
    <fieldset disabled={locked} className="lab-frame-section">
      <legend>Parámetros</legend>
      <div className="lab-model-fields">
        {controls.map((control, index) => index > manualStart && draft.controls[index - 1] === controls[index - 1].initial ? null : control.toggle
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
        {exercise.answers.map((answer, index) => {
          const { label, options, format } = answer
          const update = (value: string) => edit({ controls: draft.controls,
            answers: draft.answers.map((entry, i) => i === index ? value : entry) })
          return <label key={label}>{label}
            {options ? <select value={draft.answers[index]} onChange={event => update(event.target.value)}>
              <option value="">Elige una opción</option>
              {options.map(option => <option key={option}>{option}</option>)}
            </select> : format === 'signed-list' || format === 'attribute-sets' ? <textarea rows={2} maxLength={predictionInputLimit(answer)}
              autoComplete="off" spellCheck={false} value={draft.answers[index]} onChange={event => update(event.target.value)} />
              : <input type="text" inputMode={format === 'integer' ? 'numeric' : 'text'} autoComplete="off"
                spellCheck={false} maxLength={predictionInputLimit(answer)} value={draft.answers[index]} onChange={event => update(event.target.value)} />}
          </label>
        })}
      </div>
    </fieldset>
    <div className="lab-actions">
      <button className="button primary" disabled={locked || !complete} onClick={() => void submit()}>Comprobar predicción</button>
      <button className="button" disabled={locked} onClick={() => edit(parsePredictionDraft('', controls, describe))}>Restablecer práctica</button>
    </div>
    <p role="status">{busy ? 'Guardando la comprobación…' : graded ? latest.feedback : ''}</p>
    {graded && <section aria-label="Cálculo de la configuración" className="lab-feedback">
      <ul>{exercise.answers.map((answer, i) => <li key={answer.label}>
        <strong>{answer.label}</strong> · {matchesPredictionAnswer(answer, draft.answers[i]) ? 'Correcta' : 'Revisar'}. Resultado: {answer.expected}.
      </li>)}</ul>
      {exercise.steps.map(step => <p key={step}>{step}</p>)}
      {exercise.trace && <div role="group" aria-label="Traza paso a paso">
        <p aria-live="polite"><strong>Paso {step + 1} de {exercise.trace.length}.</strong> {exercise.trace[step]}</p>
        <div className="lab-actions">
          <button className="button" disabled={locked || step === 0} onClick={() => edit({ ...draft, step: step - 1 })}>Paso anterior</button>
          <button className="button" disabled={locked || step + 1 === exercise.trace.length}
            onClick={() => edit({ ...draft, step: step + 1 })}>Paso siguiente</button>
        </div>
      </div>}
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
