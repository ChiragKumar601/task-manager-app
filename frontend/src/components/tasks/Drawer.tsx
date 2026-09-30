import { useEffect, type ReactNode } from 'react'

interface Props {
  onClose: () => void
  label: string
  children: ReactNode
}

// A right-hand panel over the board. Escape and clicking the dimmed board both close it.
export function Drawer({ onClose, label, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </aside>
    </>
  )
}
