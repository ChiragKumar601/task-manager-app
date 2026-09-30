import { useRef, useState, type KeyboardEvent } from 'react'
import { api } from '../../lib/api'
import { todayIso } from '../../lib/tasks'
import { Link } from '../Link'

type Source = 'meeting' | 'personal'

// "- [ ] Send contract", "1. Send contract", "• Send contract" → "Send contract"
const BULLET = /^\s*(?:[-*•–—]|\d+[.)]|\[[ xX]?\])\s*/

function splitLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      let t = line
      while (BULLET.test(t)) t = t.replace(BULLET, '')
      return t.trim()
    })
    .filter(Boolean)
}

interface Draft {
  key: number
  title: string
}

let nextKey = 1

export function QuickCapturePage() {
  const [notes, setNotes] = useState('')
  const [source, setSource] = useState<Source>('meeting')
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<number | null>(null)
  const inputs = useRef(new Map<number, HTMLInputElement>())

  const lines = splitLines(notes)

  const split = () => {
    if (lines.length === 0) return
    setDrafts(lines.map((title) => ({ key: nextKey++, title })))
    setCreated(null)
    setError(null)
  }

  const update = (key: number, title: string) =>
    setDrafts((ds) => ds?.map((d) => (d.key === key ? { ...d, title } : d)) ?? null)

  const remove = (key: number) => setDrafts((ds) => ds?.filter((d) => d.key !== key) ?? null)

  // Enter in a draft splits it at the caret into a new draft below, like pressing Enter in the notes.
  const onDraftKey = (e: KeyboardEvent<HTMLInputElement>, draft: Draft, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const at = e.currentTarget.selectionStart ?? draft.title.length
      const next: Draft = { key: nextKey++, title: draft.title.slice(at).trim() }
      setDrafts((ds) => {
        if (!ds) return ds
        const copy = [...ds]
        copy.splice(index, 1, { ...draft, title: draft.title.slice(0, at).trim() }, next)
        return copy
      })
      // Caret at the start of the moved text, as in a text editor.
      requestAnimationFrame(() => {
        const input = inputs.current.get(next.key)
        input?.focus()
        input?.setSelectionRange(0, 0)
      })
    } else if (e.key === 'Backspace' && draft.title === '' && drafts && drafts.length > 1) {
      e.preventDefault()
      const prev = drafts[index - 1] ?? drafts[index + 1]
      remove(draft.key)
      if (prev) requestAnimationFrame(() => inputs.current.get(prev.key)?.focus())
    }
  }

  const create = async () => {
    const titles = (drafts ?? []).map((d) => d.title.trim()).filter(Boolean)
    if (titles.length === 0) return setError('Add at least one task.')
    setSaving(true)
    setError(null)
    try {
      const { tasks } = await api.captureTasks({ source, date: todayIso(), titles })
      setCreated(tasks.length)
      setDrafts(null)
      setNotes('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const readyCount = (drafts ?? []).filter((d) => d.title.trim()).length

  return (
    <div className="capture">
      <header className="page-header">
        <h1>Quick Capture</h1>
        <p className="muted">
          Paste meeting notes or a list of to-dos below. Each line becomes a draft task you can edit before creating.
        </p>
      </header>

      {created !== null && (
        <div className="notice success" role="status">
          <span>Created {created} task{created === 1 ? '' : 's'} in To do.</span>
          <Link href="/tasks" className="link-button">View on the board →</Link>
        </div>
      )}

      {drafts === null ? (
        <>
          <textarea className="input capture-notes" rows={10} value={notes} aria-label="Notes"
            placeholder={'Paste meeting notes or a list, one item per line…\n- Follow up with design on mockups\n- Send contract to legal'}
            onChange={(e) => {
              setNotes(e.target.value)
              setCreated(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                split()
              }
            }} />
          <div className="capture-actions">
            <select className="input" value={source} onChange={(e) => setSource(e.target.value as Source)} aria-label="Where these came from">
              <option value="meeting">From a meeting</option>
              <option value="personal">Personal</option>
            </select>
            <button type="button" className="btn btn-primary" disabled={lines.length === 0} onClick={split}>
              Split into tasks
            </button>
            {lines.length > 0 && <span className="muted small">{lines.length} line{lines.length === 1 ? '' : 's'}</span>}
          </div>
        </>
      ) : (
        <section className="capture-drafts" aria-label="Draft tasks">
          <p className="muted-text">
            {source === 'personal'
              ? 'These will be created in To do and assigned to you.'
              : 'These will be created in To do, unassigned, noted as coming from a meeting.'}
            {' '}Press Enter in a line to split it.
          </p>
          <ol className="draft-list">
            {drafts.map((d, i) => (
              <li key={d.key}>
                <span className="draft-num">{i + 1}</span>
                <input
                  ref={(el) => {
                    if (el) inputs.current.set(d.key, el)
                    else inputs.current.delete(d.key)
                  }}
                  className="input"
                  value={d.title}
                  maxLength={200}
                  aria-label={`Task ${i + 1}`}
                  onChange={(e) => update(d.key, e.target.value)}
                  onKeyDown={(e) => onDraftKey(e, d, i)}
                />
                <button type="button" className="link-button" onClick={() => remove(d.key)} aria-label={`Remove task ${i + 1}`}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="capture-actions">
            <button type="button" className="btn btn-primary" disabled={saving || readyCount === 0} onClick={() => void create()}>
              {saving ? 'Creating…' : `Create ${readyCount} to-do task${readyCount === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="btn" disabled={saving} onClick={() => setDrafts(null)}>Back to notes</button>
          </div>
        </section>
      )}
    </div>
  )
}
