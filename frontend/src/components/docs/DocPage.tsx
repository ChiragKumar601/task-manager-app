import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type BoardData, type BoardTask, type DocDetail, type DocFile, type Me } from '../../lib/api'
import { fileKind, MAX_DOC_FILE_BYTES } from '../../lib/docs'
import { navigate } from '../../lib/router'
import { escapeHtml } from '../../lib/sanitize'
import { CLOSED_STATUSES, dbTime, formatBytes, shortDateTime } from '../../lib/tasks'
import { Link } from '../Link'
import { TaskDetailPanel } from '../tasks/TaskDetailPanel'
import { DocEditor, type DocEditorHandle } from './DocEditor'
import { useAutosave, type SaveState } from './useAutosave'

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Couldn’t save',
  conflict: 'Not saved',
}

const isOpen = (t: BoardTask) => !CLOSED_STATUSES.includes(t.status) && t.parent_id === null

function taskListHtml(heading: string, tasks: BoardTask[], empty: string) {
  const items = tasks
    .map((t) => `<li><a class="doc-task" data-task-id="${t.id}" data-status="${t.status}" href="/tasks/${t.id}" contenteditable="false">${escapeHtml(t.title)}</a></li>`)
    .join('')
  return `<h2>${escapeHtml(heading)}</h2>${tasks.length ? `<ul>${items}</ul>` : `<p><em>${escapeHtml(empty)}</em></p>`}<p><br></p>`
}

// Task chips store a title snapshot; refresh them from the board so renames and moves show up.
function refreshTaskChips(root: HTMLElement | null, board: BoardData | null) {
  if (!root || !board) return
  const byId = new Map(board.tasks.map((t) => [t.id, t]))
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[data-task-id]')) {
    const t = byId.get(Number(a.dataset.taskId))
    a.dataset.status = t ? t.status : 'missing'
    if (t && a.textContent !== t.title) a.textContent = t.title
  }
}

function FilePreview({ file }: { file: DocFile }) {
  const [text, setText] = useState<string | null>(null)
  const inline = api.docFileUrl(file.id, { inline: true })

  useEffect(() => {
    if (file.mime_type !== 'text/plain' || file.size > 200_000) return
    let active = true
    fetch(inline).then((r) => r.text()).then((t) => active && setText(t), () => {})
    return () => {
      active = false
    }
  }, [file, inline])

  if (file.mime_type.startsWith('image/') && file.mime_type !== 'image/svg+xml') {
    return <img className="file-preview-image" src={inline} alt={file.filename} />
  }
  if (file.mime_type === 'application/pdf') {
    return <iframe className="file-preview-frame" src={inline} title={file.filename} />
  }
  if (file.mime_type === 'text/plain' && file.size <= 200_000) {
    return <pre className="file-preview-text">{text ?? 'Loading…'}</pre>
  }
  return <p className="muted-text">There’s no preview for this type of file — download it to open it.</p>
}

interface Props {
  id: string
  me: Me | null
}

export function DocPage({ id, me }: Props) {
  const [detail, setDetail] = useState<DocDetail | null>(null)
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null)

  useEffect(() => {
    let active = true
    api.doc(id).then(
      (d) => active && setDetail(d),
      (e: Error) => active && setLoadError({ status: e instanceof ApiError ? e.status : 0, message: e.message }),
    )
    return () => {
      active = false
    }
  }, [id])

  if (loadError) {
    return (
      <div className="doc-page">
        <Link href="/docs" className="back-link">← Docs</Link>
        <div className="card panel">
          {loadError.status === 404 ? 'This doc doesn’t exist or was deleted.' : `Couldn’t load doc: ${loadError.message}`}
        </div>
      </div>
    )
  }
  if (!detail) return <div className="doc-page"><Link href="/docs" className="back-link">← Docs</Link></div>
  return <LoadedDoc initial={detail} me={me} />
}

function LoadedDoc({ initial, me }: { initial: DocDetail; me: Me | null }) {
  const [detail, setDetail] = useState(initial)
  const [title, setTitle] = useState(initial.doc.title === 'Untitled' ? '' : initial.doc.title)
  const [clientId, setClientId] = useState(initial.doc.client_id ?? '')
  const [board, setBoard] = useState<BoardData | null>(null)
  const [openTaskId, setOpenTaskId] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const editor = useRef<DocEditorHandle>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const { doc } = detail
  const autosave = useAutosave(doc.id, doc.version, setDetail)

  const loadBoard = useCallback(async () => {
    try {
      const b = await api.board()
      setBoard(b)
      refreshTaskChips(editor.current?.root() ?? null, b)
    } catch {
      // The doc still works without the board; only task inserts need it.
    }
  }, [])

  useEffect(() => {
    api.board().then((b) => {
      setBoard(b)
      refreshTaskChips(editor.current?.root() ?? null, b)
    }, () => {})
  }, [])

  const insertTasks = (mine: boolean) => {
    if (!board) return setActionError('Tasks are still loading — try again in a moment.')
    const client = board.clients.find((c) => c.id === clientId)
    const meId = me?.user.id
    const tasks = board.tasks.filter((t) => isOpen(t) &&
      (mine ? meId !== undefined && t.assignee_ids.includes(meId) : !client || t.client_id === client.id))
    const heading = mine ? 'My tasks' : client ? `Open tasks — ${client.name}` : 'Open tasks'
    editor.current?.insertHtml(taskListHtml(heading, tasks, mine ? 'Nothing assigned to you right now.' : 'No open tasks right now.'))
  }

  const uploadIntoDoc = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_DOC_FILE_BYTES) return setActionError(`${file.name} is over 10 MB.`)
    setUploading(true)
    setActionError(null)
    try {
      const { file: saved } = await api.uploadDocFile(doc.id, file)
      editor.current?.insertHtml(
        `<p><a class="doc-file" data-file-id="${saved.id}" href="${api.docFileUrl(saved.id)}" contenteditable="false">📎 ${escapeHtml(saved.filename)} · ${formatBytes(saved.size)}</a></p>`,
      )
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`Delete “${doc.title}”? This can’t be undone.`)) return
    try {
      await api.deleteDoc(doc.id)
      navigate('/docs', { replace: true })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  const takeTheirs = () => {
    const theirs = autosave.acceptTheirs()
    if (!theirs) return
    setDetail(theirs)
    setTitle(theirs.doc.title === 'Untitled' ? '' : theirs.doc.title)
    setClientId(theirs.doc.client_id ?? '')
    editor.current?.setHtml(theirs.doc.content_html)
    refreshTaskChips(editor.current?.root() ?? null, board)
  }

  const source = detail.files.find((f) => f.role === 'source')

  return (
    <div className="doc-page">
      <div className="doc-head">
        <input className="doc-title-input" value={title} placeholder="Untitled" maxLength={200} aria-label="Title"
          onChange={(e) => {
            setTitle(e.target.value)
            autosave.schedule({ title: e.target.value })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && doc.kind === 'page') {
              e.preventDefault()
              editor.current?.focus()
            }
          }} />
        <div className="doc-head-actions">
          <span className={`save-state ${autosave.state}`} aria-live="polite">{SAVE_LABEL[autosave.state]}</span>
          <select className="input" value={clientId} aria-label="Client"
            onChange={(e) => {
              setClientId(e.target.value)
              autosave.schedule({ client_id: e.target.value || null }, { immediate: true })
            }}>
            <option value="">No client</option>
            {board?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            {!board && clientId && <option value={clientId}>…</option>}
          </select>
          {detail.permissions.canDelete && (
            <button type="button" className="link-button" onClick={() => void remove()}>Delete</button>
          )}
        </div>
      </div>

      <p className="doc-byline">
        Created by {doc.creator_name} · last edited by {doc.updater_name} {shortDateTime(doc.updated_at)}
      </p>

      {autosave.conflict && (
        <div className="notice" role="alert">
          <span>
            {autosave.conflict.doc.updater_name} changed this doc{' '}
            {dbTime(autosave.conflict.doc.updated_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            {' '}while you were editing. Your latest edits aren’t saved yet.
          </span>
          <span className="notice-actions">
            <button type="button" className="btn btn-small" onClick={takeTheirs}>Load their version</button>
            <button type="button" className="btn btn-small btn-primary" onClick={autosave.keepMine}>Keep mine</button>
          </span>
        </div>
      )}
      {autosave.state === 'error' && (
        <div className="notice" role="alert">
          <span>Couldn’t save: {autosave.error}</span>
          <button type="button" className="btn btn-small" onClick={() => void autosave.flush()}>Try again</button>
        </div>
      )}
      {actionError && <p className="form-error" role="alert">{actionError}</p>}

      {doc.kind === 'upload' && source ? (
        <section className="file-card">
          <div className="file-card-head">
            <span className="file-badge">{fileKind(source.mime_type, source.filename)}</span>
            <div className="file-card-name">
              <strong>{source.filename}</strong>
              <span className="muted small">{formatBytes(source.size)} · uploaded {shortDateTime(source.created_at)}</span>
            </div>
            <a className="btn btn-small" href={api.docFileUrl(source.id)} download={source.filename}>Download</a>
          </div>
          <FilePreview file={source} />
        </section>
      ) : (
        <DocEditor
          ref={editor}
          initialHtml={doc.content_html}
          onChange={(html) => autosave.schedule({ content_html: html })}
          onOpenTask={setOpenTaskId}
          onOpenFile={(fileId) => window.open(api.docFileUrl(fileId, { inline: true }), '_blank', 'noopener')}
          toolbarExtras={
            <>
              <button type="button" className="tool" onMouseDown={(e) => e.preventDefault()} onClick={() => insertTasks(false)}
                title={clientId ? 'Insert this client’s open tasks' : 'Insert all open tasks'}>+ Open tasks</button>
              <button type="button" className="tool" onMouseDown={(e) => e.preventDefault()} onClick={() => insertTasks(true)}
                title="Insert open tasks assigned to you">+ My tasks</button>
              <button type="button" className="tool" onMouseDown={(e) => e.preventDefault()} disabled={uploading}
                onClick={() => fileInput.current?.click()}>{uploading ? 'Uploading…' : '+ Upload document'}</button>
              <input ref={fileInput} type="file" hidden onChange={(e) => {
                void uploadIntoDoc(e.target.files?.[0])
                e.target.value = ''
              }} />
            </>
          }
        />
      )}

      {openTaskId !== null && board && (
        <TaskDetailPanel
          key={openTaskId}
          taskId={openTaskId}
          board={board}
          meId={me?.user.id}
          onClose={() => setOpenTaskId(null)}
          onChanged={loadBoard}
          onOpenTask={setOpenTaskId}
        />
      )}
    </div>
  )
}
