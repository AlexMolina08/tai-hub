import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Dialog({ title, children, onClose, wide = false }: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className={wide ? 'dialog dialog-wide' : 'dialog'} aria-labelledby="dialog-title"
    onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="dialog-head"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={21} /></button></div>
    <div className="dialog-body">{children}</div>
  </dialog>
}
