import { useEffect, useState } from 'react'
import { api, type TaskEvent } from '../../lib/api'
import { dbTime, formatDuration, priorityOf, shortDateTime, statusOf } from '../../lib/tasks'
import { Avatar } from '../Avatar'

// One uninterrupted stretch of time the task spent in a single status.
interface Stage {
  status: string
  start: Date
  end: Date | null // null = still in this status
  events: TaskEvent[]
}

function buildStages(events: TaskEvent[]): Stage[] {
  const stages: Stage[] = []
  for (const e of events) {
    const at = dbTime(e.created_at)
    const last = stages[stages.length - 1]
    if (e.kind === 'created' || (e.kind === 'status' && !last)) {
      stages.push({ status: e.to_value ?? 'todo', start: at, end: null, events: [e] })
    } else if (e.kind === 'status') {
      last!.end = at
      stages.push({ status: e.to_value ?? 'todo', start: at, end: null, events: [e] })
    } else if (last) {
      last.events.push(e)
    }
  }
  return stages
}

const DATE_FIELDS: Record<string, string> = { start_date: 'start date', end_date: 'end date', due_date: 'due date' }
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString()

function describe(e: TaskEvent): string {
  const from = e.from_value
  const to = e.to_value
  switch (e.kind) {
    case 'created': return `created this task in ${statusOf(to ?? 'todo').label}`
    case 'status': return `moved it from ${statusOf(from ?? '').label} to ${statusOf(to ?? '').label}`
    case 'priority': return `changed priority from ${priorityOf(from ?? 'none').label} to ${priorityOf(to ?? 'none').label}`
    case 'title': return `renamed it from “${from}” to “${to}”`
    case 'description': return 'updated the description'
    case 'client':
      if (!to) return `removed the client ${from ?? ''}`.trim()
      return from ? `changed the client from ${from} to ${to}` : `set the client to ${to}`
    case 'start_date':
    case 'end_date':
    case 'due_date': {
      const field = DATE_FIELDS[e.kind]
      if (!to) return `cleared the ${field}`
      return from ? `changed the ${field} from ${fmtDate(from)} to ${fmtDate(to)}` : `set the ${field} to ${fmtDate(to)}`
    }
    case 'assignee_added': return `assigned ${to}`
    case 'assignee_removed': return `unassigned ${from}`
    case 'label_added': return `added the label ${to}`
    case 'label_removed': return `removed the label ${from}`
    default: return 'changed the task'
  }
}

// Re-renders every minute so "so far" durations keep ticking.
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

interface Props {
  taskId: number
  title: string
  // Bumped by the parent after each change so history refetches.
  version: number
}

export function TaskHistory({ taskId, title, version }: Props) {
  const [events, setEvents] = useState<TaskEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const now = useNow()

  useEffect(() => {
    let active = true
    api.taskHistory(taskId).then(
      (r) => active && setEvents(r.events),
      (e: Error) => active && setError(e.message),
    )
    return () => {
      active = false
    }
  }, [taskId, version])

  if (error) return <p className="form-error">Couldn’t load history: {error}</p>
  if (!events) return <p className="muted-text">Loading…</p>

  const stages = buildStages(events)
  const index = selected !== null && selected < stages.length ? selected : stages.length - 1
  const stage = stages[index]
  const span = (s: Stage) => (s.end ?? new Date(now)).getTime() - s.start.getTime()

  return (
    <div className="history">
      <h2 className="history-title">{title}</h2>

      <div className="field">
        <span>Stages</span>
        <ol className="stages">
          {stages.map((s, i) => {
            const st = statusOf(s.status)
            return (
              <li key={i}>
                {i > 0 && <span className="stage-arrow" aria-hidden="true">→</span>}
                <button type="button" className={`stage-chip${i === index ? ' selected' : ''}`}
                  style={{ borderColor: i === index ? st.color : undefined }}
                  aria-pressed={i === index} onClick={() => setSelected(i)}>
                  <span className="pill-dot" style={{ background: st.color }} aria-hidden="true" />
                  <span className="stage-name">{st.label}</span>
                  <span className="stage-time">{formatDuration(span(s))}{s.end ? '' : ' · now'}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      {stage && (
        <section className="stage-detail" style={{ borderColor: statusOf(stage.status).color }}>
          <h3>{statusOf(stage.status).label}</h3>
          <p className="stage-range">
            {stage.start.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            {' → '}
            {stage.end
              ? `${stage.end.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${formatDuration(span(stage))}`
              : `now · ${formatDuration(span(stage))} so far`}
          </p>
          <ul className="event-list">
            {stage.events.map((e) => (
              <li key={e.id}>
                <Avatar name={e.actor_name} size={20} />
                <div>
                  <p><strong>{e.actor_name}</strong> {describe(e)}</p>
                  <time className="event-time" dateTime={dbTime(e.created_at).toISOString()}>{shortDateTime(e.created_at)}</time>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
