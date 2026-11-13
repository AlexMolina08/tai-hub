import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { Dialog } from '../components/Dialog'
import './editor-workspace.css'

export function EditorWorkspace({ name, className = '', prompt, children }: {
  name: string; className?: string; prompt?: ReactNode; children: ReactNode
}) {
  const workspace = useRef<HTMLDialogElement>(null)
  const expandButton = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  const originalScroll = useRef({ x: 0, y: 0 })
  const labelId = useId()

  useEffect(() => {
    if (!expanded) return
    const dialog = workspace.current!
    const viewport = window.visualViewport
    function fit() {
      dialog.style.setProperty('--editor-viewport-height', `${viewport?.height ?? window.innerHeight}px`)
      dialog.style.setProperty('--editor-viewport-top', `${viewport?.offsetTop ?? 0}px`)
    }
    fit()
    window.addEventListener('resize', fit)
    viewport?.addEventListener('resize', fit)
    viewport?.addEventListener('scroll', fit)
    return () => {
      window.removeEventListener('resize', fit)
      viewport?.removeEventListener('resize', fit)
      viewport?.removeEventListener('scroll', fit)
    }
  }, [expanded])

  function toggle() {
    const dialog = workspace.current!
    if (expanded) {
      dialog.close()
      dialog.setAttribute('open', '')
      setExpanded(false)
      expandButton.current?.focus({ preventScroll: true })
      const { x, y } = originalScroll.current
      window.scrollTo({ left: x, top: y, behavior: 'instant' })
      return
    }
    originalScroll.current = { x: window.scrollX, y: window.scrollY }
    // Promote the inline dialog without moving or remounting the editors.
    dialog.close()
    dialog.showModal()
    setExpanded(true)
    const editor = [...dialog.querySelectorAll('textarea')].find(node => node.getClientRects().length && !node.disabled)
    editor?.focus({ preventScroll: true })
  }

  return <dialog ref={workspace} open className={`lab-editor-workspace lab-sql ${className}`}
    role={expanded ? undefined : 'group'} aria-labelledby={labelId}
    onCancel={event => { event.preventDefault(); if (expanded) toggle() }}>
    <div className="lab-editor-inner">
      <div className="lab-editor-header">
        <h4 id={labelId}>{name}</h4>
        <button ref={expandButton} className="button" type="button" onClick={toggle}>
          {expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
          {expanded ? 'Volver a la actividad' : 'Ampliar editor'}
        </button>
      </div>
      {expanded && prompt && <details className="lab-editor-prompt">
        <summary>Ver enunciado</summary>{prompt}
      </details>}
      {children}
    </div>
  </dialog>
}

export function EditorOutput({ title, long, children }: { title: string; long: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return <section className="lab-editor-output">
    <div className="lab-editor-output-header">
      <h4>{title}</h4>
      {long && <button ref={trigger} className="button" type="button" onClick={() => {
        trigger.current?.focus({ preventScroll: true })
        setOpen(true)
      }}>Ampliar resultado</button>}
    </div>
    {open ? <Dialog title={title} wide className="lab-editor-result-dialog" closeLabel="Volver al editor" showCloseLabel
      preserveScroll onClose={() => setOpen(false)}>{children}</Dialog> : children}
  </section>
}
