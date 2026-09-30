import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { api, type BoardData, type BoardTask, type Me } from '../../lib/api'
import { navigate } from '../../lib/router'
import { STATUSES, type StatusKey } from '../../lib/tasks'
import { NewTaskPanel } from './NewTaskPanel'
import { TaskCard } from './TaskCard'
import { TaskDetailPanel } from './TaskDetailPanel'

interface Filters {
  q: string
  assignee: string // 'all' | 'me' | 'none' | user id
  label: string // 'all' | label id
  client: string // 'all' | 'none' | client id
}

const DEFAULT_FILTERS: Filters = { q: '', assignee: 'all', label: 'all', client: 'all' }

function readFilters(): Filters {
  const p = new URLSearchParams(window.location.search)
  return {
    q: p.get('q') ?? '',
    assignee: p.get('assignee') ?? 'all',
    label: p.get('label') ?? 'all',
    client: p.get('client') ?? 'all',
  }
}

// Filters live in the query string so a filtered board can be shared or reloaded.
function writeFilters(f: Filters) {
  const p = new URLSearchParams()
  for (const key of Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]) {
    if (f[key] !== DEFAULT_FILTERS[key]) p.set(key, f[key])
  }
  const qs = p.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
}

function matches(task: BoardTask, f: Filters, meId: number | undefined) {
  if (f.q) {
    const q = f.q.toLowerCase()
    if (!task.title.toLowerCase().includes(q) && !task.description.toLowerCase().includes(q)) return false
  }
  if (f.assignee === 'me' && (meId === undefined || !task.assignee_ids.includes(meId))) return false
  if (f.assignee === 'none' && task.assignee_ids.length > 0) return false
  if (/^\d+$/.test(f.assignee) && !task.assignee_ids.includes(Number(f.assignee))) return false
  if (f.label !== 'all' && !task.label_ids.includes(Number(f.label))) return false
  if (f.client === 'none' && task.client_id !== null) return false
  if (f.client !== 'all' && f.client !== 'none' && task.client_id !== f.client) return false
  return true
}

interface Props {
  me: Me | null
  path: string
}

export function TasksPage({ me, path }: Props) {
  const [board, setBoard] = useState<BoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(readFilters)
  const [newTaskStatus, setNewTaskStatus] = useState<StatusKey | null>(null)
  const [dragging, setDragging] = useState<BoardTask | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const openId = /^\/tasks\/(\d+)$/.exec(path)?.[1]
  const openTaskId = openId ? Number(openId) : null

  const reload = useCallback(async () => {
    try {
      setBoard(await api.board())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    api.board().then(setBoard, (e: Error) => setError(e.message))
  }, [])

  useEffect(() => writeFilters(filters), [filters])

  const setFilter = (key: keyof Filters, value: string) => setFilters((f) => ({ ...f, [key]: value }))

  const members = useMemo(() => new Map((board?.members ?? []).map((m) => [m.id, m])), [board])
  const labels = useMemo(() => new Map((board?.labels ?? []).map((l) => [l.id, l])), [board])
  const meId = me?.user.id
  const iAmOwner = meId !== undefined && members.get(meId)?.role === 'owner'

  // Mirrors the server rule so we only offer drag where the move will be accepted.
  const canEdit = (t: BoardTask) =>
    meId !== undefined && (t.created_by === meId || t.assignee_ids.includes(meId) || iAmOwner)

  const visible = useMemo(
    () => (board?.tasks ?? []).filter((t) => matches(t, filters, meId)),
    [board, filters, meId],
  )

  const openTask = (id: number) => navigate(`/tasks/${id}${window.location.search}`)
  const closeTask = useCallback(() => navigate(`/tasks${window.location.search}`), [])

  const moveTask = async (task: BoardTask, status: string) => {
    if (!board || task.status === status) return
    const before = board
    // Optimistic: show it at the bottom of the new column straight away.
    setBoard({
      ...board,
      tasks: board.tasks.map((t) => (t.id === task.id ? { ...t, status, position: Number.MAX_SAFE_INTEGER } : t)),
    })
    try {
      await api.updateTask(task.id, { status })
      await reload()
    } catch (e) {
      setBoard(before)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onDrop = (e: DragEvent, status: string) => {
    e.preventDefault()
    setDropTarget(null)
    if (dragging) void moveTask(dragging, status)
    setDragging(null)
  }

  const hasFilters = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS)

  return (
    <div className="tasks-page">
      <header className="board-toolbar">
        <div className="board-title">
          <h1>Tasks</h1>
          <button type="button" className="btn btn-primary" onClick={() => setNewTaskStatus('todo')}>+ New task</button>
        </div>
        <div className="board-filters">
          <input className="input" type="search" placeholder="Search tasks…" value={filters.q}
            onChange={(e) => setFilter('q', e.target.value)} aria-label="Search tasks" />
          <select className="input" value={filters.assignee} onChange={(e) => setFilter('assignee', e.target.value)}
            aria-label="Filter by assignee">
            <option value="all">Everyone</option>
            <option value="me">Assigned to me</option>
            <option value="none">Unassigned</option>
            {board?.members.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
          </select>
          <select className="input" value={filters.label} onChange={(e) => setFilter('label', e.target.value)}
            aria-label="Filter by label">
            <option value="all">All labels</option>
            {board?.labels.map((l) => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
          </select>
          <select className="input" value={filters.client} onChange={(e) => setFilter('client', e.target.value)}
            aria-label="Filter by client">
            <option value="all">All clients</option>
            <option value="none">No client</option>
            {board?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {hasFilters && (
            <button type="button" className="link-button" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear</button>
          )}
        </div>
      </header>

      {error && (
        <div className="board-error" role="alert">
          {error}
          <button type="button" className="link-button" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="board">
        {STATUSES.map((status) => {
          const cards = visible
            .filter((t) => t.status === status.key)
            .sort((a, b) => a.position - b.position || a.id - b.id)
          return (
            <section
              key={status.key}
              className={`column${dropTarget === status.key ? ' drop-target' : ''}`}
              aria-label={status.label}
              onDragOver={(e) => {
                if (!dragging) return
                e.preventDefault()
                setDropTarget(status.key)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null)
              }}
              onDrop={(e) => onDrop(e, status.key)}
            >
              <header className="column-head">
                <span className="column-name">{status.label}</span>
                <span className="column-count">{cards.length}</span>
              </header>
              <div className="column-cards">
                {cards.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    members={members}
                    labels={labels}
                    draggable={canEdit(t)}
                    onOpen={() => openTask(t.id)}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', String(t.id))
                      setDragging(t)
                    }}
                    onDragEnd={() => {
                      setDragging(null)
                      setDropTarget(null)
                    }}
                  />
                ))}
                {board && cards.length === 0 && <p className="column-empty">{hasFilters ? 'No matching tasks' : 'No tasks'}</p>}
              </div>
              <button type="button" className="add-task" onClick={() => setNewTaskStatus(status.key)}>+ Add task</button>
            </section>
          )
        })}
      </div>

      {newTaskStatus && board && (
        <NewTaskPanel
          board={board}
          meId={meId}
          initialStatus={newTaskStatus}
          initialClient={filters.client !== 'all' && filters.client !== 'none' ? filters.client : null}
          onClose={() => setNewTaskStatus(null)}
          onCreated={async (uploadErrors) => {
            setNewTaskStatus(null)
            if (uploadErrors.length) setError(`Task created, but some files didn’t upload: ${uploadErrors.join('; ')}`)
            await reload()
          }}
        />
      )}

      {openTaskId !== null && board && (
        <TaskDetailPanel
          key={openTaskId}
          taskId={openTaskId}
          board={board}
          meId={meId}
          onClose={closeTask}
          onChanged={reload}
          onOpenTask={openTask}
        />
      )}
    </div>
  )
}
