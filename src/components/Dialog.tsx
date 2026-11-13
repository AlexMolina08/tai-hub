import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Dialog({ title, children, onClose, wide = false, className = '', closeLabel = 'Cerrar', showCloseLabel = false, preserveScroll = false }: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
  className?: string
  closeLabel?: string
  showCloseLabel?: boolean
  preserveScroll?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useLayoutEffect(() => {
    const dialog = ref.current!
    const trigger = document.activeElement
    const { scrollX, scrollY } = window
    dialog.showModal()
    return () => {
      dialog.close()
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true })
      if (preserveScroll) window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' })
    }
  }, [preserveScroll])
  return <dialog ref={ref} className={['dialog', wide && 'dialog-wide', className].filter(Boolean).join(' ')} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="dialog-head"><h2 id={titleId}>{title}</h2>
      <button type="button" className={showCloseLabel ? 'button dialog-close-text' : 'icon-button'} onClick={onClose}
        aria-label={closeLabel} title={closeLabel}><X size={showCloseLabel ? 16 : 21} aria-hidden="true" />
        {showCloseLabel && <span>{closeLabel}</span>}</button>
    </div>
    <div className="dialog-body">{children}</div>
  </dialog>
}
