import type { NotificationKind, NotificationPrefs } from './api'

// The settings list, in the order shown, and which notification kind each one covers.
export const PREF_OPTIONS: { key: keyof NotificationPrefs; kind: NotificationKind; label: string }[] = [
  { key: 'mentions', kind: 'mention', label: '@mentions' },
  { key: 'assignments', kind: 'assignment', label: 'Assignments' },
  { key: 'status_changes', kind: 'status_change', label: 'Status changes on my tasks' },
  { key: 'due_reminders', kind: 'due_reminder', label: 'Due date reminders' },
  { key: 'change_requests', kind: 'change_request', label: 'Change requests on tasks I manage' },
  { key: 'request_decisions', kind: 'request_decision', label: 'Decisions on my requests' },
]

export const prefKeyFor = (kind: NotificationKind) => PREF_OPTIONS.find((o) => o.kind === kind)?.key

// "now", "3m", "2h", "4d", then a date.
export function relativeTime(date: Date, now = Date.now()) {
  const minutes = Math.floor((now - date.getTime()) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
