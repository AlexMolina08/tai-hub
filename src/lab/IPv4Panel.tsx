import { useRef, useState } from 'react'
import type { IPv4Input, IPv4Prediction } from './ipv4'
import type { IPv4ModelActivity, LabEvent } from './model'
import { editIPv4View, parseIPv4View, planIPv4Prediction, planIPv4Reset, planIPv4Reveal, readIPv4Workflow, serializeIPv4View } from './ipv4-workflow'
import { IPv4Result } from './IPv4Result'

export function IPv4Panel({ activity, saved, disabled, unsaved, events, context, takeActiveMs, save }: {
  activity: IPv4ModelActivity; saved: string; disabled: boolean; unsaved: boolean; events: LabEvent[];
  context: { accountId: string; deviceId: string; packageId: string; packageVersion: string; attemptGroupId: string };
  takeActiveMs: () => number; save: (value: string, companions?: LabEvent[]) => Promise<void>
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const resultRegion = useRef<HTMLDivElement>(null)
  let view, workflow
  try {
    view = parseIPv4View(saved)
    workflow = readIPv4Workflow(activity, { ...context, createdAt: new Date().toISOString(), activeMs: 0 }, view, events)
  } catch (failure) {
    return <div className="lab-ipv4" role="alert"><p>{failure instanceof Error ? failure.message : 'No se pudo leer el caso guardado.'}</p>
      <label>Copia del caso guardado<textarea readOnly rows={8} value={saved} /></label></div>
  }
  const current = view, state = workflow
  const blocked = disabled || busy || unsaved || state.status === 'pending'
  const prediction = current.prediction
  function edit(patch: { input?: Partial<IPv4Input>; prediction?: Partial<IPv4Prediction> }) {
    try {
      const next = editIPv4View(current, patch)
      setError('')
      // The parent retains failed edits and presents retry/copy controls across navigation.
      void save(serializeIPv4View(next)).catch(() => {})
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo editar el caso.') }
  }
  async function act(kind: 'predict' | 'omit' | 'reveal' | 'reset') {
    setBusy(true); setError('')
    try {
      const ctx = { ...context, createdAt: new Date().toISOString(), activeMs: 0 }
      const ids = { resetId: crypto.randomUUID(), attemptId: crypto.randomUUID(), revealId: crypto.randomUUID(),
        assistanceId: crypto.randomUUID(), exposureId: crypto.randomUUID(), predictionId: crypto.randomUUID() }
      const prepare = (activeMs: number) => kind === 'reset' ? planIPv4Reset(activity, ctx, current, events, ids)
        : kind === 'reveal' ? planIPv4Reveal(activity, ctx, current, events, ids)
        : planIPv4Prediction(activity, { ...ctx, activeMs }, kind === 'omit'
          ? editIPv4View(current, { prediction: { omitted: true } }) : current, events, ids)
      let plan = prepare(0)
      // Invalid inputs do not consume the active-time counter; retries retain the prepared event.
      if (kind === 'predict' || kind === 'omit') plan = prepare(takeActiveMs())
      await save(serializeIPv4View(plan.view), plan.events)
      if (kind === 'reveal') requestAnimationFrame(() => {
        resultRegion.current?.focus(); resultRegion.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
      })
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar esta acción.') }
    finally { setBusy(false) }
  }
  return <div className="lab-ipv4">
    <p className="lab-mode">Cambia un dato, predice y compara. Cada variante sigue siendo práctica del mismo ejercicio.</p>
    {current.phase === 'editing' ? <>
      <fieldset disabled={disabled || busy}><legend>1. Configura el caso</legend>
        <div className="lab-ipv4-fields">
          <label>Dirección IPv4<input value={current.input.address} maxLength={64} inputMode="decimal" spellCheck={false} onChange={event => edit({ input: { address: event.target.value } })} /></label>
          <label>Formato<select value={current.input.format} onChange={event => edit({ input: { format: event.target.value } })}>
            <option value="prefix">Longitud de prefijo</option><option value="mask">Máscara decimal</option>
          </select></label>
          <label>{current.input.format === 'mask' ? 'Máscara decimal' : 'Longitud del prefijo'}<input value={current.input.value} maxLength={64} inputMode="decimal" spellCheck={false} onChange={event => edit({ input: { value: event.target.value } })} /></label>
          <label>Dirección de prueba (opcional)<input value={current.input.probe} maxLength={64} inputMode="decimal" spellCheck={false} onChange={event => edit({ input: { probe: event.target.value } })} /></label>
          <label className="lab-ipv4-wide">Contexto de interpretación<select value={current.input.context} onChange={event => edit({ input: { context: event.target.value } })}>
            <option value="numeric">Solo límites numéricos</option><option value="conventional">Subred unicast convencional</option><option value="p2p-compatible">Enlace /31 punto a punto compatible</option>
          </select></label>
        </div>
      </fieldset>
      <fieldset disabled={disabled || busy}><legend>2. Escribe tu predicción</legend>
        <p className="lab-mode">Puedes dejar campos sin responder. Tu explicación se conserva sin calificación automática.</p>
        <div className="lab-ipv4-fields">
          <label>Predicción del límite inferior<input value={prediction.lower} maxLength={64} inputMode="decimal" spellCheck={false} onChange={event => edit({ prediction: { omitted: false, lower: event.target.value } })} /></label>
          <label>Predicción del límite superior<input value={prediction.upper} maxLength={64} inputMode="decimal" spellCheck={false} onChange={event => edit({ prediction: { omitted: false, upper: event.target.value } })} /></label>
          {current.input.probe.trim() && <label className="lab-ipv4-wide">¿La dirección de prueba pertenece al bloque?<select value={prediction.member} onChange={event => edit({ prediction: { omitted: false, member: event.target.value as IPv4Prediction['member'] } })}>
            <option value="omit">Sin predecir</option><option value="yes">Dentro del bloque</option><option value="no">Fuera del bloque</option>
          </select></label>}
          <label className="lab-ipv4-wide">Explica tu razonamiento (opcional)<textarea value={prediction.interpretationNote} rows={3} maxLength={500} onChange={event => edit({ prediction: { omitted: false, interpretationNote: event.target.value } })} /></label>
        </div>
      </fieldset>
      <div className="lab-actions"><button className="button primary" disabled={blocked} onClick={() => void act('predict')}>Guardar predicción</button>
        <button className="button" disabled={blocked} onClick={() => void act('omit')}>Continuar sin predecir</button></div>
    </> : <>
      <details><summary>Caso guardado: {current.input.address} · {current.input.value}</summary>
        <p>Formato: {current.input.format === 'mask' ? 'máscara decimal' : 'longitud de prefijo'}. Dirección de prueba: {current.input.probe || 'ninguna'}.</p>
        <p>Contexto: {current.input.context === 'numeric' ? 'solo numérico' : current.input.context === 'conventional' ? 'subred convencional' : 'enlace /31 punto a punto compatible'}.</p>
      </details>
      {state.status === 'predicted' && !unsaved && <><p role="status">{prediction.omitted ? 'Omisión guardada.' : 'Predicción guardada.'} Revela el cálculo para compararla.</p>
        <button className="button primary" disabled={blocked} onClick={() => void act('reveal')}>Revelar cálculo</button></>}
    </>}
    {(state.status === 'pending' || unsaved && current.phase !== 'editing') && <p role="status">Esta vista espera el guardado completo del caso y sus eventos. Sincroniza o reintenta el guardado antes de continuar.</p>}
    <div ref={resultRegion} tabIndex={-1}>
      {state.status === 'revealed' && !unsaved && state.result && state.comparison && <IPv4Result result={state.result} comparison={state.comparison} prediction={prediction} />}
    </div>
    <div className="lab-actions">
      {current.phase !== 'editing' && <button className="button" disabled={blocked} onClick={() => edit({ input: { ...current.input } })}>Editar otro caso</button>}
      <button className="button" disabled={blocked} onClick={() => void act('reset')}>Volver al caso inicial</button>
    </div>
    <p className="lab-mode">Editar o reiniciar conserva las predicciones y los resultados anteriores en tu historial.</p>
    {error && <p role="alert">{error}</p>}
  </div>
}
