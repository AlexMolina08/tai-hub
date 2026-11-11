import { useEffect, useRef, useState } from 'react'
import type { HtmlActivity } from './model'
import { inspectHtml } from './html-preview'

export function HtmlPanel({ activity, saved, disabled, save, onResult }: {
  activity: HtmlActivity; saved: string; disabled: boolean; save: (value: string) => Promise<void>;
  onResult: (value: string, correct: boolean, feedback: string) => Promise<void>
}) {
  const [source, setSource] = useState<{ html: string; css: string }>(() => {
    try { const value = JSON.parse(saved); if (typeof value.html === 'string' && typeof value.css === 'string') return value } catch { /* No saved editor value yet. */ }
    return activity.starter
  })
  const [width, setWidth] = useState(activity.cases[0].width)
  const [status, setStatus] = useState('')
  const [running, setRunning] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const controller = useRef<AbortController>(undefined)
  useEffect(() => () => controller.current?.abort(), [])
  const error = (failure: unknown) => setStatus(failure instanceof Error ? failure.message : 'No se pudo mostrar la vista.')
  const update = (value: typeof source) => { setSource(value); void save(JSON.stringify(value)).catch(error) }
  async function execute(check: boolean) {
    setRunning(true); setStatus(check ? 'Comprobando los tamaños del ejercicio…' : 'Actualizando la vista…')
    controller.current = new AbortController()
    try {
      await save(JSON.stringify(source))
      if (!check) {
        await inspectHtml(frame.current!, source, width, [], controller.current.signal)
        setStatus('Vista actualizada. Puedes modificarla o comprobarla.'); return
      }
      let correct = true, feedback = ''
      for (const c of activity.cases) {
        setWidth(c.width)
        const values = await inspectHtml(frame.current!, source, c.width, c.checks, controller.current.signal)
        for (const [i, test] of c.checks.entries()) if (values[i] !== test.expected) {
          correct = false
          feedback ||= `Revisa ${test.selector} a ${c.width} px: ${test.kind === 'style' ? test.property : test.kind === 'count' ? 'cantidad de elementos' : test.kind === 'text' ? 'contenido' : test.property} no cumple el requisito.`
        }
      }
      feedback = correct ? 'El HTML y CSS cumplen los casos comprobados.' : feedback
      await onResult(JSON.stringify(source), correct, feedback)
      setStatus(feedback)
    } catch (failure) { error(failure) }
    finally { setRunning(false) }
  }
  return <div className="lab-html lab-sql">
    <label htmlFor={`html-${activity.id}`}>HTML</label>
    <textarea id={`html-${activity.id}`} value={source.html} rows={6} spellCheck={false} autoCapitalize="off" autoCorrect="off"
      disabled={running || disabled} onChange={e => update({ ...source, html: e.target.value })} />
    <label htmlFor={`css-${activity.id}`}>CSS</label>
    <textarea id={`css-${activity.id}`} value={source.css} rows={7} spellCheck={false} autoCapitalize="off" autoCorrect="off"
      disabled={running || disabled} onChange={e => update({ ...source, css: e.target.value })} />
    <label>Ancho de la vista <select value={width} disabled={running} onChange={e => setWidth(Number(e.target.value))}>
      {[...new Set(activity.cases.map(c => c.width))].map(value => <option key={value} value={value}>{value} px</option>)}
    </select></label>
    <div className="lab-actions">
      <button className="button" disabled={running || disabled} onClick={() => void execute(false)}>Actualizar vista</button>
      <button className="button primary" disabled={running || disabled} onClick={() => void execute(true)}>Comprobar HTML y CSS</button>
      <button className="button" disabled={running || disabled} onClick={() => { update(activity.starter); setStatus('Código restablecido. Actualiza la vista para verlo.'); if (frame.current) frame.current.srcdoc = '' }}>Restablecer código</button>
    </div>
    <p role="status">{status}</p>
    <div className="lab-html-preview" tabIndex={0} role="region" aria-label="Vista HTML y CSS">
      <iframe ref={frame} title="Resultado HTML y CSS" sandbox="allow-scripts" referrerPolicy="no-referrer" />
    </div>
  </div>
}
