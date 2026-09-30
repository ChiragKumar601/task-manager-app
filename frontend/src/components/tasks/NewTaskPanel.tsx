import { useRef, useState, type DragEvent, type FormEvent } from 'react'
import { api, type BoardData } from '../../lib/api'
import {
  formatBytes, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, PRIORITIES, STATUSES, todayIso, type StatusKey,
} from '../../lib/tasks'
import { Drawer } from './Drawer'
import { AssigneePicker, LabelPicker } from './Pickers'

interface Props {
  board: BoardData
  meId: number | undefined
  initialStatus: StatusKey
  initialClient: string | null
  onClose: () => void
  // Called once the task exists; any files that failed to upload are listed.
  onCreated: (uploadErrors: string[]) => void
}

export function NewTaskPanel({ board, initialStatus, initialClient, onClose, onCreated }: Props) {
  const today = todayIso()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<string>(initialStatus)
  const [priority, setPriority] = useState('none')
  const [clientId, setClientId] = useState(initialClient ?? '')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [dueDate, setDueDate] = useState('')
  const [assignees, setAssignees] = useState<number[]>([])
  const [labelIds, setLabelIds] = useState<number[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const dirty = title.trim() !== '' || description.trim() !== '' || files.length > 0

  const close = () => {
    if (dirty && !window.confirm('Discard this new task?')) return
    onClose()
  }

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const incoming = [...list]
    const tooBig = incoming.filter((f) => f.size > MAX_ATTACHMENT_BYTES)
    const ok = incoming.filter((f) => f.size <= MAX_ATTACHMENT_BYTES)
    const room = MAX_ATTACHMENTS - files.length
    const problems: string[] = []
    if (tooBig.length) problems.push(`${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} over 5 MB`)
    if (ok.length > room) problems.push(`only ${MAX_ATTACHMENTS} files are allowed`)
    setError(problems.length ? `Couldn’t add every file: ${problems.join('; ')}.` : null)
    setFiles((current) => [...current, ...ok.slice(0, Math.max(0, room))])
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    addFiles(e.dataTransfer.files)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return setError('Give the task a title.')
    if (!startDate || !endDate) return setError('Start and end dates are required.')
    if (endDate < startDate) return setError('End date can’t be before the start date.')

    setSaving(true)
    setError(null)
    try {
      const { task } = await api.createTask({
        title: title.trim(),
        description,
        status,
        priority,
        client_id: clientId || null,
        start_date: startDate,
        end_date: endDate,
        due_date: dueDate || null,
        assignee_ids: assignees,
        label_ids: labelIds,
      })
      const uploadErrors: string[] = []
      for (const file of files) {
        try {
          await api.uploadAttachment(task.id, file)
        } catch (err) {
          uploadErrors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      onCreated(uploadErrors)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <Drawer onClose={close} label="New task">
      <form className="panel-form" onSubmit={submit} noValidate>
        <div className="drawer-head">
          <h2>New task</h2>
          <button type="button" className="link-button" onClick={close}>Close</button>
        </div>

        <input className="input title-input" placeholder="Task title" value={title} maxLength={200}
          onChange={(e) => setTitle(e.target.value)} aria-label="Task title" autoFocus />
        <textarea className="input" rows={4} placeholder="Add a description…" value={description}
          onChange={(e) => setDescription(e.target.value)} aria-label="Description" />

        <div className="field-row">
          <label className="field">
            <span>Status</span>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Priority</span>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Client</span>
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">No client</option>
            {board.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        <div className="field-row">
          <label className="field">
            <span>Start date <span className="required" aria-hidden="true">*</span></span>
            <input className="input" type="date" value={startDate} required
              onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="field">
            <span>End date <span className="required" aria-hidden="true">*</span></span>
            <input className="input" type="date" value={endDate} min={startDate} required
              onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>Due date</span>
          <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>

        <div className="field">
          <span>Assignees</span>
          <AssigneePicker options={board.members} value={assignees} onChange={setAssignees} />
        </div>

        <div className="field">
          <span>Labels</span>
          <LabelPicker options={board.labels} value={labelIds} onChange={setLabelIds} />
        </div>

        <div className="field">
          <span>Attachments</span>
          <button
            type="button"
            className={`dropzone${dragOver ? ' over' : ''}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            disabled={files.length >= MAX_ATTACHMENTS}
          >
            <span>Drop files here or click to browse</span>
            <span className="small">Up to {MAX_ATTACHMENTS} files, 5MB each</span>
          </button>
          <input ref={fileInput} type="file" multiple hidden
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }} />
          {files.length > 0 && (
            <ul className="file-list">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  <span className="file-name">{f.name}</span>
                  <span className="muted small">{formatBytes(f.size)}</span>
                  <button type="button" className="link-button" aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
          {saving ? 'Creating…' : 'Create task'}
        </button>
      </form>
    </Drawer>
  )
}
