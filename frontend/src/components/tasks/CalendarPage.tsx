import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type BoardData, type BoardTask, type Me } from '../../lib/api'
import { navigate } from '../../lib/router'
import { CLOSED_STATUSES, priorityOf, statusOf, todayIso } from '../../lib/tasks'
import { TaskDetailPanel } from './TaskDetailPanel'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_RE = /^(\d{4})-(\d{2})$/

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

// The month shown lives in ?month=YYYY-MM so it survives reloads and opening a task.
function readMonth(): { year: number; month: number } {
  const match = MONTH_RE.exec(new URLSearchParams(window.location.search).get('month') ?? '')
  if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) {
    return { year: Number(match[1]), month: Number(match[2]) - 1 }
  }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() }
}

// Leading nulls pad the first week so day 1 lands under its weekday.
function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1).getDay()
  const days = new Date(year, month + 1, 0).getDate()
  return [...Array<null>(first).fill(null), ...Array.from({ length: days }, (_, i) => iso(year, month, i + 1))]
}

function TaskChip({ task, onOpen }: { task: BoardTask; onOpen: () => void }) {
  const closed = CLOSED_STATUSES.includes(task.status)
  return (
    <button type="button" className={`cal-task${closed ? ' closed' : ''}`} onClick={onOpen}
      title={`${task.title} · ${statusOf(task.status).label} · ${priorityOf(task.priority).label}`}>
      <span className="pill-dot" style={{ background: priorityOf(task.priority).color }} aria-hidden="true" />
      <span className="cal-task-title">{task.title}</span>
    </button>
  )
}

interface Props {
  me: Me | null
  path: string
}

export function CalendarPage({ me, path }: Props) {
  const [board, setBoard] = useState<BoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [{ year, month }, setView] = useState(readMonth)

  const openId = /^\/calendar\/(\d+)$/.exec(path)?.[1]
  const openTaskId = openId ? Number(openId) : null

  useEffect(() => {
    api.board().then(setBoard, (e: Error) => setError(e.message))
  }, [])

  const reload = useCallback(async () => {
    try {
      setBoard(await api.board())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    const now = new Date()
    const isCurrent = year === now.getFullYear() && month === now.getMonth()
    const qs = isCurrent ? '' : `?month=${year}-${String(month + 1).padStart(2, '0')}`
    window.history.replaceState(null, '', `${window.location.pathname}${qs}`)
  }, [year, month])

  const shift = (delta: number) => {
    const d = new Date(year, month + delta, 1)
    setView({ year: d.getFullYear(), month: d.getMonth() })
  }
  const goToday = () => {
    const now = new Date()
    setView({ year: now.getFullYear(), month: now.getMonth() })
  }

  const { byDay, noDueDate } = useMemo(() => {
    const byDay = new Map<string, BoardTask[]>()
    const noDueDate: BoardTask[] = []
    for (const t of board?.tasks ?? []) {
      if (!t.due_date) {
        noDueDate.push(t)
        continue
      }
      const list = byDay.get(t.due_date) ?? []
      list.push(t)
      byDay.set(t.due_date, list)
    }
    // Open tasks first, then by priority, so what matters sits at the top of a busy day.
    const rank = (t: BoardTask) => (CLOSED_STATUSES.includes(t.status) ? 10 : 0) +
      ['urgent', 'high', 'medium', 'low', 'none'].indexOf(t.priority)
    for (const list of byDay.values()) list.sort((a, b) => rank(a) - rank(b) || a.id - b.id)
    return { byDay, noDueDate }
  }, [board])

  const cells = monthCells(year, month)
  const today = todayIso()
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const openTask = (id: number) => navigate(`/calendar/${id}${window.location.search}`)
  const closeTask = useCallback(() => navigate(`/calendar${window.location.search}`), [])

  return (
    <div className="calendar-page">
      <header className="board-toolbar">
        <div className="board-title"><h1>Calendar</h1></div>
        <div className="cal-nav">
          <button type="button" className="icon-button" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <span className="cal-month" aria-live="polite">{monthLabel}</span>
          <button type="button" className="icon-button" onClick={() => shift(1)} aria-label="Next month">›</button>
          <button type="button" className="btn btn-small" onClick={goToday}>Today</button>
        </div>
      </header>

      {error && (
        <div className="board-error" role="alert">
          {error}
          <button type="button" className="link-button" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="cal-body">
        <div className="cal-grid-wrap">
          <div className="cal-weekdays" aria-hidden="true">
            {WEEKDAYS.map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="cal-grid" style={{ gridTemplateRows: `repeat(${Math.ceil(cells.length / 7)}, minmax(96px, 1fr))` }}>
            {cells.map((day, i) => {
              if (!day) return <div key={`pad-${i}`} className="cal-cell pad" aria-hidden="true" />
              const tasks = byDay.get(day) ?? []
              const date = Number(day.slice(8))
              return (
                <div key={day} className="cal-cell"
                  aria-label={`${new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}, ${tasks.length} task${tasks.length === 1 ? '' : 's'} due`}>
                  <span className={`cal-date${day === today ? ' today' : ''}`}>{date}</span>
                  <div className="cal-tasks">
                    {tasks.map((t) => <TaskChip key={t.id} task={t} onOpen={() => openTask(t.id)} />)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <aside className="cal-side" aria-label="Tasks with no due date">
          <h2>No due date</h2>
          {board && noDueDate.length === 0 && <p className="muted-text">Every task has a due date.</p>}
          <ul>
            {noDueDate.map((t) => (
              <li key={t.id}>
                <button type="button" className={`cal-side-task${CLOSED_STATUSES.includes(t.status) ? ' closed' : ''}`}
                  onClick={() => openTask(t.id)} title={t.title}>
                  {t.title}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {openTaskId !== null && board && (
        <TaskDetailPanel
          key={openTaskId}
          taskId={openTaskId}
          board={board}
          meId={me?.user.id}
          onClose={closeTask}
          onChanged={reload}
          onOpenTask={openTask}
        />
      )}
    </div>
  )
}
