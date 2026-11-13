import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Dialog({ title, children, onClose, wide = false, className = '', closeLabel = 'Cerrar' }: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
  className?: string
  closeLabel?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useLayoutEffect(() => {
    const dialog = ref.current!
    const trigger = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [])
  return <dialog ref={ref} className={['dialog', wide && 'dialog-wide', className].filter(Boolean).join(' ')} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="dialog-head"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label={closeLabel} title={closeLabel}><X size={21} /></button></div>
    <div className="dialog-body">{children}</div>
  </dialog>
}
