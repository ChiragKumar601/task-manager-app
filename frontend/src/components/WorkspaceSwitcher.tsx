import { useEffect, useRef, useState } from 'react'
import type { Me } from '../lib/api'
import { Link } from './Link'

interface Props {
  me: Me | null
  onSwitch: (workspaceId: number) => Promise<void>
}

export function WorkspaceSwitcher({ me, onSwitch }: Props) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = async (id: number) => {
    setError(null)
    try {
      if (id !== me?.workspace.id) await onSwitch(id)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="workspace-switcher" ref={ref}>
      <button type="button" className="workspace-name" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        {me?.workspace.name ?? '…'} <span className="chevron" aria-hidden="true">⌄</span>
      </button>
      {open && me && (
        <div className="menu" role="menu">
          <div className="menu-heading">Workspaces</div>
          {me.workspaces.map((w) => (
            <button key={w.id} type="button" role="menuitemradio" aria-checked={w.id === me.workspace.id}
              className="menu-item" onClick={() => void choose(w.id)}>
              <span className="menu-check" aria-hidden="true">{w.id === me.workspace.id ? '✓' : ''}</span>
              <span className="menu-label">{w.name}</span>
              {w.role === 'owner' && <span className="menu-meta">Owner</span>}
            </button>
          ))}
          {error && <p className="form-error menu-error">{error}</p>}
          <div className="menu-divider" />
          <Link href="/settings/workspace" className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
            <span className="menu-check" aria-hidden="true" />
            <span className="menu-label">Workspace settings</span>
          </Link>
        </div>
      )}
    </div>
  )
}
