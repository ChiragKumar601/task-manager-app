import { useState, type FormEvent } from 'react'
import type { ClientInput } from '../lib/api'
import { CLIENT_COLORS } from '../lib/clients'
import { ColorSwatches } from './ColorSwatches'

interface Props {
  initial: ClientInput
  submitLabel?: string
  // Resolves on success; a rejection's message is shown above the buttons.
  onSave: (input: ClientInput) => Promise<void>
  onCancel: () => void
}

// Edits a local draft — nothing reaches the server until Save is pressed.
export function ClientForm({ initial, submitLabel = 'Save', onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof ClientInput>(key: K, value: ClientInput[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft.name.trim()) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <form className="card client-form" onSubmit={handleSubmit} noValidate>
      <label className="field">
        <span>Name</span>
        <input
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          maxLength={120}
          autoFocus
          required
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span>Email</span>
          <input type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
        </label>
        <label className="field">
          <span>Phone</span>
          <input type="tel" value={draft.phone} onChange={(e) => set('phone', e.target.value)} maxLength={40} />
        </label>
      </div>

      <label className="field">
        <span>Notes</span>
        <textarea rows={3} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
      </label>

      <fieldset className="field">
        <legend>Color</legend>
        <ColorSwatches colors={CLIENT_COLORS} value={draft.color} onChange={(c) => set('color', c)} />
      </fieldset>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  )
}
