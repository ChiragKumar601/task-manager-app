export const STATUSES = [
  { key: 'backlog', label: 'Backlog', color: '#6b7280' },
  { key: 'todo', label: 'To do', color: '#3b82f6' },
  { key: 'in_progress', label: 'In progress', color: '#f59e0b' },
  { key: 'testing', label: 'Testing & Validation', color: '#8b5cf6' },
  { key: 'done', label: 'Done', color: '#22c55e' },
  { key: 'canceled', label: 'Canceled', color: '#ef4444' },
] as const

export type StatusKey = (typeof STATUSES)[number]['key']

export const PRIORITIES = [
  { key: 'urgent', label: 'Urgent', color: '#ef4444' },
  { key: 'high', label: 'High', color: '#f97316' },
  { key: 'medium', label: 'Medium', color: '#eab308' },
  { key: 'low', label: 'Low', color: '#3b82f6' },
  { key: 'none', label: 'No priority', color: '#6b7280' },
] as const

export type PriorityKey = (typeof PRIORITIES)[number]['key']

export const CLOSED_STATUSES: string[] = ['done', 'canceled']

export const MAX_ATTACHMENTS = 5
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

export const statusOf = (key: string) => STATUSES.find((s) => s.key === key) ?? STATUSES[1]
export const priorityOf = (key: string) => PRIORITIES.find((p) => p.key === key) ?? PRIORITIES[4]

// Today as YYYY-MM-DD in the viewer's time zone.
export function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Calendar dates (YYYY-MM-DD) are local; parse them at local midnight.
const calendarDate = (iso: string) => new Date(`${iso}T00:00:00`)

// SQLite datetime('now') values are UTC without a zone marker.
export const dbTime = (value: string) => new Date(`${value.replace(' ', 'T')}Z`)

export const shortDate = (iso: string) =>
  calendarDate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export const numericDate = (iso: string) => calendarDate(iso).toLocaleDateString()

export const shortDateTime = (value: string) =>
  dbTime(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function formatDuration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const isOverdue = (dueDate: string | null, status: string) =>
  !!dueDate && dueDate < todayIso() && !CLOSED_STATUSES.includes(status)
