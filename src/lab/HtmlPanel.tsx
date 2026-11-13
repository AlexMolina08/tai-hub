import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Attempt, HtmlActivity } from './model'
import { inspectHtml } from './html-preview'
import { EditorWorkspace } from './EditorWorkspace'

const panes = { html: 'HTML', css: 'CSS', preview: 'Vista previa' } as const
type Pane = keyof typeof panes

export function HtmlPanel({ activity, saved, latest, disabled, save, onResult, focusPrompt }: {
  activity: HtmlActivity; saved: string; disabled: boolean; save: (value: string) => Promise<void>;
  onResult: (value: string, correct: boolean, feedback: string) => Promise<void>; latest?: Attempt; focusPrompt?: ReactNode
}) {
  const [source, setSource] = useState<{ html: string; css: string }>(() => {
    try { const value = JSON.parse(saved); if (typeof value.html === 'string' && typeof value.css === 'string') return value } catch { /* No saved editor value yet. */ }
    return activity.starter
  })
  useEffect(() => {
    try {
      const value = JSON.parse(saved)
      if (typeof value.html === 'string' && typeof value.css === 'string') setSource(value)
    } catch { /* Keep the current editor value when the stored representation cannot be read. */ }
  }, [saved])
  const [width, setWidth] = useState(activity.cases[0].width)
  const [pane, setPane] = useState<Pane>('html')
  const [executionStatus, setExecutionStatus] = useState<{ draft: string; text: string }>()
  const draft = JSON.stringify(source)
  const setStatus = (text: string) => setExecutionStatus({ draft, text })
  const status = executionStatus?.draft === draft ? executionStatus.text : latest?.answer === draft ? latest.feedback : ''
  const [running, setRunning] = useState(false)
  const preview = useRef<HTMLDivElement>(null)
  const controller = useRef<AbortController>(undefined)
  useEffect(() => () => controller.current?.abort(), [])
  const error = (failure: unknown) => setStatus(failure instanceof Error ? failure.message : 'No se pudo mostrar la vista.')
  // The parent buffer displays autosave failures and owns their retry/copy controls across navigation.
  const update = (value: typeof source) => { setSource(value); void save(JSON.stringify(value)).catch(() => {}) }
  async function execute(check: boolean) {
    setRunning(true); setStatus(check ? 'Comprobando los tamaños del ejercicio…' : 'Actualizando la vista…')
    const { signal } = controller.current = new AbortController()
    try {
      await save(draft)
      if (!check) {
        await inspectHtml(preview.current!, source, width, [], signal)
        setPane('preview')
        setStatus('Vista actualizada. Puedes modificarla o comprobarla.'); return
      }
      let correct = true, feedback = ''
      for (const c of activity.cases) {
        setWidth(c.width)
        const values = await inspectHtml(preview.current!, source, c.width, c.checks, signal)
        for (const [i, test] of c.checks.entries()) if (values[i] !== test.expected) {
          correct = false
          feedback ||= `Revisa ${test.selector} a ${c.width} px: ${test.kind === 'style' ? test.property : test.kind === 'count' ? 'cantidad de elementos' : test.kind === 'text' ? 'contenido' : test.property} no cumple el requisito.`
        }
      }
      feedback = correct ? 'El HTML y CSS cumplen los casos comprobados.' : feedback
      await onResult(draft, correct, feedback)
      setStatus(feedback)
    } catch (failure) { error(failure) }
    finally { setRunning(false) }
  }
  return <EditorWorkspace name="Editor HTML y CSS" className="lab-html lab-editor-html" prompt={focusPrompt}>
    <div className="lab-editor-pane-tabs" role="group" aria-label="Vista del editor">
      {(['html', 'css', 'preview'] as const).map(item => <button className="button" key={item} type="button"
        aria-pressed={pane === item} onClick={() => setPane(item)}>{panes[item]}</button>)}
    </div>
    <div className="lab-editor-layout">
      <div className="lab-editor-fields">
        {(['html', 'css'] as const).map(language => <div key={language} data-pane-active={pane === language}>
          <label htmlFor={`${language}-${activity.id}`}>{panes[language]}</label>
          <textarea id={`${language}-${activity.id}`} value={source[language]} rows={language === 'html' ? 6 : 7}
            spellCheck={false} autoCapitalize="off" autoCorrect="off" disabled={running || disabled}
            onChange={event => update({ ...source, [language]: event.target.value })} />
        </div>)}
        <div className="lab-actions">
          <button className="button" disabled={running || disabled} onClick={() => void execute(false)}>Actualizar vista</button>
          <button className="button primary" disabled={running || disabled} onClick={() => void execute(true)}>Comprobar HTML y CSS</button>
        </div>
        <p role="status">{status}</p>
      </div>
      <div className="lab-editor-preview-pane" data-pane-active={pane === 'preview'}>
        <div className="lab-html-preview-controls">
          <label>Ancho de la vista <select value={width} disabled={running} onChange={event => setWidth(Number(event.target.value))}>
            {[...new Set(activity.cases.map(c => c.width))].map(value => <option key={value} value={value}>{value} px</option>)}
          </select></label>
        </div>
        <div ref={preview} className="lab-html-preview" tabIndex={0} role="region" aria-label="Vista HTML y CSS" />
      </div>
    </div>
    <button className="text-link lab-editor-reset" disabled={running || disabled} onClick={() => {
      update(activity.starter)
      setExecutionStatus({ draft: JSON.stringify(activity.starter), text: 'Código restablecido. Actualiza la vista para verlo.' })
      preview.current?.replaceChildren()
    }}>Restablecer código</button>
  </EditorWorkspace>
}
