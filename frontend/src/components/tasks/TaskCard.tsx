import type { DragEvent, KeyboardEvent } from 'react'
import type { BoardMember, BoardTask, Label } from '../../lib/api'
import { isOverdue, numericDate, priorityOf, shortDate, dbTime } from '../../lib/tasks'
import { Avatar } from '../Avatar'

interface Props {
  task: BoardTask
  members: Map<number, BoardMember>
  labels: Map<number, Label>
  draggable: boolean
  onOpen: () => void
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
}

export function PriorityPill({ priority }: { priority: string }) {
  const p = priorityOf(priority)
  return (
    <span className="pill">
      <span className="pill-dot" style={{ background: p.color }} aria-hidden="true" />
      {p.label}
    </span>
  )
}

export function TaskCard({ task, members, labels, draggable, onOpen, onDragStart, onDragEnd }: Props) {
  const assignees = task.assignee_ids.map((id) => members.get(id)).filter((m) => m !== undefined)
  const created = dbTime(task.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return (
    // A div rather than a <button>: Firefox won't start a drag from a button.
    <div
      role="button"
      tabIndex={0}
      className="task-card"
      draggable={draggable}
      aria-roledescription={draggable ? 'draggable task' : undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      {task.parent_title && <span className="card-parent">↳ {task.parent_title}</span>}
      <span className="card-title">{task.title}</span>

      <span className="card-meta">
        <PriorityPill priority={task.priority} />
        <span>{shortDate(task.start_date)} – {shortDate(task.end_date)}</span>
        {task.checklist_total > 0 && <span>☑ {task.checklist_done}/{task.checklist_total}</span>}
      </span>

      <span className="card-meta">
        {task.due_date && (
          <span className={isOverdue(task.due_date, task.status) ? 'overdue' : 'card-due'}>
            Due {numericDate(task.due_date)}
          </span>
        )}
        {task.comment_count > 0 && (
          <span>{task.comment_count} comment{task.comment_count === 1 ? '' : 's'}</span>
        )}
        <span>by {task.creator_name} · {created}</span>
      </span>

      {task.label_ids.length > 0 && (
        <span className="card-labels">
          {task.label_ids.map((id) => labels.get(id)).filter((l) => l !== undefined).map((l) => (
            <span key={l.id} className="mini-label" style={{ color: l.color, borderColor: l.color }}>{l.name}</span>
          ))}
        </span>
      )}

      <span className="card-avatars" aria-label={assignees.length ? `Assigned to ${assignees.map((a) => a.name).join(', ')}` : 'Unassigned'}>
        {assignees.length === 0 ? (
          <span className="avatar avatar-empty" aria-hidden="true">?</span>
        ) : (
          assignees.map((a) => <Avatar key={a.id} name={a.name} size={20} />)
        )}
      </span>
    </div>
  )
}
