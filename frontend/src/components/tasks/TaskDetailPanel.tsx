import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { api, type BoardData, type TaskDetail, type TaskInput } from '../../lib/api'
import {
  formatBytes, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, PRIORITIES, shortDateTime, STATUSES, statusOf,
} from '../../lib/tasks'
import { Avatar } from '../Avatar'
import { Drawer } from './Drawer'
import { AssigneePicker, LabelPicker } from './Pickers'
import { PriorityPill } from './TaskCard'
import { TaskHistory } from './TaskHistory'

interface Props {
  taskId: number
  board: BoardData
  meId: number | undefined
  onClose: () => void
  // Lets the board refresh its cards after anything here changes.
  onChanged: () => Promise<void> | void
  onOpenTask: (id: number) => void
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Renders @First or @First Last as a highlighted mention when it matches a member.
function CommentBody({ body, names }: { body: string; names: string[] }) {
  const alternatives = names
    .flatMap((n) => [n, n.split(/\s+/)[0] ?? n])
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (alternatives.length === 0) return <p className="comment-body">{body}</p>
  const parts = body.split(new RegExp(`(@(?:${alternatives.join('|')})\\b)`, 'gi'))
  return (
    <p className="comment-body">
      {parts.map((part, i) => (i % 2 === 1 ? <span key={i} className="mention">{part}</span> : part))}
    </p>
  )
}

export function TaskDetailPanel({ taskId, board, onClose, onChanged, onOpenTask }: Props) {
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'details' | 'history'>('details')
  const [version, setVersion] = useState(0)
  const [titleDraft, setTitleDraft] = useState('')
  const [descDraft, setDescDraft] = useState('')
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [checklistText, setChecklistText] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // Every successful write returns the fresh detail; keep drafts and the board in step.
  const apply = useCallback((d: TaskDetail) => {
    setDetail(d)
    setTitleDraft(d.task.title)
    setDescDraft(d.task.description)
    setVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    let active = true
    api.task(taskId).then(
      (d) => active && apply(d),
      (e: Error) => active && setLoadError(e.message),
    )
    return () => {
      active = false
    }
  }, [taskId, apply])

  const run = async (fn: () => Promise<TaskDetail | void>) => {
    setBusy(true)
    setError(null)
    try {
      const d = await fn()
      if (d) apply(d)
      await onChanged()
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const patch = (input: TaskInput) => run(() => api.updateTask(taskId, input))

  if (loadError) {
    return (
      <Drawer onClose={onClose} label="Task">
        <div className="drawer-head"><button type="button" className="link-button" onClick={onClose}>Close</button></div>
        <p className="form-error">{loadError.startsWith('404') || loadError === 'Task not found'
          ? 'This task doesn’t exist or was deleted.' : `Couldn’t load task: ${loadError}`}</p>
      </Drawer>
    )
  }

  if (!detail) {
    return (
      <Drawer onClose={onClose} label="Task">
        <div className="drawer-head"><button type="button" className="link-button" onClick={onClose}>Close</button></div>
        <p className="muted-text">Loading…</p>
      </Drawer>
    )
  }

  const { task, permissions } = detail
  const locked = !permissions.canEdit || busy
  const memberNames = board.members.map((m) => m.name)

  const saveTitle = () => {
    const t = titleDraft.trim()
    if (!t) return setTitleDraft(task.title)
    if (t !== task.title) void patch({ title: t })
  }

  const onTitleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') {
      e.preventDefault()
      setTitleDraft(task.title)
      e.currentTarget.blur()
    }
  }

  const addSubtask = async (e: FormEvent) => {
    e.preventDefault()
    if (!subtaskTitle.trim()) return
    const ok = await run(async () => {
      await api.createTask({
        title: subtaskTitle.trim(),
        parent_id: task.id,
        status: 'todo',
        start_date: task.start_date,
        end_date: task.end_date,
        client_id: task.client_id,
      })
      return api.task(task.id)
    })
    if (ok) setSubtaskTitle('')
  }

  const addChecklist = async (e: FormEvent) => {
    e.preventDefault()
    if (!checklistText.trim()) return
    if (await run(() => api.addChecklistItem(task.id, checklistText.trim()))) setChecklistText('')
  }

  const postComment = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!comment.trim()) return
    if (await run(() => api.addComment(task.id, comment.trim()))) setComment('')
  }

  const uploadFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    const files = [...list]
    const room = MAX_ATTACHMENTS - detail.attachments.length
    if (files.length > room) return setError(`A task can have at most ${MAX_ATTACHMENTS} attachments.`)
    const tooBig = files.find((f) => f.size > MAX_ATTACHMENT_BYTES)
    if (tooBig) return setError(`${tooBig.name} is over 5 MB.`)
    await run(async () => {
      let last: TaskDetail | undefined
      for (const f of files) last = await api.uploadAttachment(task.id, f)
      return last
    })
  }

  const deleteTask = async () => {
    const extra = detail.subtasks.length ? ` Its ${detail.subtasks.length} subtask(s) will be deleted too.` : ''
    if (!window.confirm(`Delete “${task.title}”?${extra} This can’t be undone.`)) return
    if (await run(() => api.deleteTask(task.id))) onClose()
  }

  const creator = task.creator_name

  return (
    <Drawer onClose={onClose} label={task.title}>
      <div className="drawer-head">
        <button type="button" className="link-button" onClick={onClose}>Close</button>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'on' : ''}
            onClick={() => setTab('details')}>Details</button>
          <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''}
            onClick={() => setTab('history')}>History</button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {tab === 'history' ? (
        <TaskHistory taskId={task.id} title={task.title} version={version} />
      ) : (
        <div className="panel-form">
          <p className="created-by">
            <Avatar name={creator} size={16} />
            Created by {creator} on {shortDateTime(task.created_at)}
          </p>

          {!permissions.canEdit && (
            <div className="notice">
              <span>Only the task’s creator, assignees and workspace owners can change it. You can still comment.</span>
              <button type="button" className="btn btn-small" disabled={permissions.hasPendingRequest || busy}
                onClick={() => void run(() => api.askToBeAssigned(task.id))}>
                {permissions.hasPendingRequest ? 'Request sent' : 'Ask to be assigned'}
              </button>
            </div>
          )}

          {permissions.canEdit && detail.requests.map((r) => (
            <div key={r.id} className="notice">
              <span><strong>{r.requester_name}</strong> asked to be assigned.</span>
              <span className="notice-actions">
                <button type="button" className="btn btn-small btn-primary" disabled={busy}
                  onClick={() => void run(() => api.resolveRequest(r.id, 'approved'))}>Approve</button>
                <button type="button" className="btn btn-small" disabled={busy}
                  onClick={() => void run(() => api.resolveRequest(r.id, 'rejected'))}>Decline</button>
              </span>
            </div>
          ))}

          {task.parent_id !== null && (
            <button type="button" className="link-button parent-link" onClick={() => onOpenTask(task.parent_id!)}>
              ↳ Subtask of {task.parent_title}
            </button>
          )}

          <input className="input title-input title-edit" value={titleDraft} maxLength={200} readOnly={!permissions.canEdit}
            onChange={(e) => setTitleDraft(e.target.value)} onBlur={saveTitle} onKeyDown={onTitleKey} aria-label="Title" />

          <textarea className="input" rows={4} value={descDraft} readOnly={!permissions.canEditDescription}
            placeholder={permissions.canEditDescription ? 'Add a description…' : 'No description.'}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={() => permissions.canEditDescription && descDraft !== task.description && void patch({ description: descDraft })}
            aria-label="Description" aria-describedby={permissions.canEdit && !permissions.canEditDescription ? 'desc-owner-note' : undefined} />
          {permissions.canEdit && !permissions.canEditDescription && (
            <p id="desc-owner-note" className="muted-text small field-note">Only {creator} can edit the description.</p>
          )}

          <div className="field">
            <span>Assignees</span>
            <AssigneePicker options={board.members} value={task.assignee_ids} disabled={locked}
              onChange={(ids) => void patch({ assignee_ids: ids })} />
          </div>

          <label className="field">
            <span>Status</span>
            <select className="input" value={task.status} disabled={locked}
              onChange={(e) => void patch({ status: e.target.value })}>
              {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>

          <div className="field-row">
            <label className="field">
              <span>Priority</span>
              <select className="input" value={task.priority} disabled={locked}
                onChange={(e) => void patch({ priority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Client</span>
              <select className="input" value={task.client_id ?? ''} disabled={locked}
                onChange={(e) => void patch({ client_id: e.target.value || null })}>
                <option value="">No client</option>
                {board.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Start date</span>
              <input className="input" type="date" value={task.start_date} disabled={locked} required
                onChange={(e) => e.target.value && void patch({ start_date: e.target.value })} />
            </label>
            <label className="field">
              <span>End date</span>
              <input className="input" type="date" value={task.end_date} min={task.start_date} disabled={locked} required
                onChange={(e) => e.target.value && void patch({ end_date: e.target.value })} />
            </label>
          </div>

          <label className="field">
            <span>Due date</span>
            <input className="input" type="date" value={task.due_date ?? ''} disabled={locked}
              onChange={(e) => void patch({ due_date: e.target.value || null })} />
          </label>

          <div className="field">
            <span>Labels</span>
            <LabelPicker options={board.labels} value={task.label_ids} disabled={locked}
              onChange={(ids) => void patch({ label_ids: ids })} />
          </div>

          {task.parent_id === null && (
            <div className="field">
              <span>Subtasks</span>
              {detail.subtasks.length === 0 ? (
                <p className="muted-text">No subtasks.</p>
              ) : (
                <ul className="sub-list">
                  {detail.subtasks.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="sub-row" onClick={() => onOpenTask(s.id)}>
                        <span className="pill-dot" style={{ background: statusOf(s.status).color }} aria-hidden="true" />
                        <span className="sub-title">{s.title}</span>
                        <span className="muted small">{statusOf(s.status).label}</span>
                        <PriorityPill priority={s.priority} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {permissions.canEdit && (
                <form className="add-row" onSubmit={addSubtask}>
                  <input className="input" placeholder="Add a subtask" value={subtaskTitle} maxLength={200}
                    onChange={(e) => setSubtaskTitle(e.target.value)} aria-label="New subtask title" />
                  <button type="submit" className="btn btn-small" disabled={busy || !subtaskTitle.trim()}>Add</button>
                </form>
              )}
            </div>
          )}

          <div className="field">
            <span>Checklist</span>
            {detail.checklist.length === 0 ? (
              <p className="muted-text">No checklist items.</p>
            ) : (
              <ul className="check-list">
                {detail.checklist.map((c) => (
                  <li key={c.id}>
                    <label>
                      <input type="checkbox" checked={c.done} disabled={locked}
                        onChange={(e) => void run(() => api.setChecklistDone(c.id, e.target.checked))} />
                      <span className={c.done ? 'done' : ''}>{c.text}</span>
                    </label>
                    {permissions.canEdit && (
                      <button type="button" className="link-button" aria-label={`Delete “${c.text}”`} disabled={busy}
                        onClick={() => void run(() => api.deleteChecklistItem(c.id))}>Remove</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {permissions.canEdit && (
              <form className="add-row" onSubmit={addChecklist}>
                <input className="input" placeholder="Add an item" value={checklistText} maxLength={500}
                  onChange={(e) => setChecklistText(e.target.value)} aria-label="New checklist item" />
                <button type="submit" className="btn btn-small" disabled={busy || !checklistText.trim()}>Add</button>
              </form>
            )}
          </div>

          <div className="field">
            <span>Attachments</span>
            {detail.attachments.length === 0 ? (
              <p className="muted-text">No attachments.</p>
            ) : (
              <ul className="file-list">
                {detail.attachments.map((a) => (
                  <li key={a.id}>
                    <a className="file-name" href={api.attachmentUrl(a.id)} download={a.filename}>{a.filename}</a>
                    <span className="muted small">{formatBytes(a.size)}</span>
                    {permissions.canEdit && (
                      <button type="button" className="link-button" disabled={busy}
                        onClick={() => window.confirm(`Remove ${a.filename}?`) && void run(() => api.deleteAttachment(a.id))}>
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {permissions.canEdit && detail.attachments.length < MAX_ATTACHMENTS && (
              <>
                <button type="button" className="btn btn-small add-file" disabled={busy}
                  onClick={() => fileInput.current?.click()}>Attach files</button>
                <input ref={fileInput} type="file" multiple hidden
                  onChange={(e) => {
                    void uploadFiles(e.target.files)
                    e.target.value = ''
                  }} />
              </>
            )}
          </div>

          <div className="field">
            <span>Comments</span>
            {detail.comments.length === 0 ? (
              <p className="muted-text">No comments yet.</p>
            ) : (
              <ul className="comment-list">
                {detail.comments.map((c) => (
                  <li key={c.id}>
                    <Avatar name={c.author_name} size={22} />
                    <div>
                      <p className="comment-head"><strong>{c.author_name}</strong> <span className="muted small">{shortDateTime(c.created_at)}</span></p>
                      <CommentBody body={c.body} names={memberNames} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <form className="comment-form" onSubmit={postComment}>
              <textarea className="input" rows={2} placeholder="Add a comment. Use @ to mention someone." value={comment}
                maxLength={5000} onChange={(e) => setComment(e.target.value)} aria-label="New comment"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void postComment()
                }} />
              <button type="submit" className="btn btn-primary btn-small" disabled={busy || !comment.trim()}>Comment</button>
            </form>
          </div>

          {permissions.canDelete && (
            <button type="button" className="link-button danger-link" onClick={() => void deleteTask()} disabled={busy}>
              Delete task
            </button>
          )}
        </div>
      )}
    </Drawer>
  )
}
