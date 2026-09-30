export interface User {
  id: number
  name: string
  email: string
}

export interface Workspace {
  id: number
  name: string
}

export type Role = 'owner' | 'member'

export interface Me {
  user: User
  workspace: Workspace
  workspaces: (Workspace & { role: Role })[]
}

export interface Member {
  id: number
  name: string
  email: string
  role: Role
}

export interface Label {
  id: number
  name: string
  color: string
}

export interface DashboardData {
  stats: {
    myOpenTasks: number
    overdue: number
    dueThisWeek: number
    awaitingReview: number
    unreadInbox: number
  }
  dueSoon: {
    id: number
    title: string
    priority: string
    due_date: string
    is_overdue: number
  }[]
  reviews: {
    id: number
    note: string
    task_title: string
    requested_by: string
  }[]
  byStatus: { key: string; label: string; count: number }[]
  byPerson: { id: number; name: string; count: number }[]
  unassignedOpen: number
}

export interface ClientSummary {
  id: string
  name: string
  color: string
  task_count: number
  doc_count: number
}

export interface Client {
  id: string
  name: string
  email: string
  phone: string
  notes: string
  color: string
  created_at: string
  updated_at: string
}

export type ClientInput = Pick<Client, 'name' | 'email' | 'phone' | 'notes' | 'color'>

export interface ClientDetail {
  client: Client
  tasks: { id: number; title: string; status: string; status_label: string; due_date: string | null }[]
  docs: { id: string; title: string; created_at: string }[]
}

export interface BoardTask {
  id: number
  parent_id: number | null
  parent_title: string | null
  title: string
  description: string
  status: string
  priority: string
  start_date: string
  end_date: string
  due_date: string | null
  client_id: string | null
  position: number
  created_by: number
  creator_name: string
  created_at: string
  assignee_ids: number[]
  label_ids: number[]
  comment_count: number
  checklist_total: number
  checklist_done: number
}

export interface BoardMember {
  id: number
  name: string
  role: Role
}

export interface BoardData {
  tasks: BoardTask[]
  members: BoardMember[]
  labels: Label[]
  clients: { id: string; name: string; color: string }[]
}

export interface TaskInput {
  title?: string
  description?: string
  status?: string
  priority?: string
  client_id?: string | null
  start_date?: string
  end_date?: string
  due_date?: string | null
  assignee_ids?: number[]
  label_ids?: number[]
  parent_id?: number
}

export interface TaskDetail {
  task: BoardTask
  subtasks: BoardTask[]
  checklist: { id: number; text: string; done: boolean }[]
  comments: { id: number; body: string; created_at: string; author_id: number; author_name: string }[]
  attachments: { id: number; filename: string; mime_type: string; size: number; created_at: string }[]
  requests: { id: number; requested_by: number; requester_name: string; created_at: string }[]
  permissions: { canEdit: boolean; canEditDescription: boolean; canDelete: boolean; hasPendingRequest: boolean }
}

export interface TaskEvent {
  id: number
  kind: string
  from_value: string | null
  to_value: string | null
  created_at: string
  actor_id: number
  actor_name: string
}

export interface DocSummary {
  id: string
  kind: 'page' | 'upload'
  title: string
  client_id: string | null
  client_name: string | null
  client_color: string | null
  updated_at: string
  updater_name: string
  file_mime: string | null
  file_size: number | null
}

export interface DocFile {
  id: number
  role: 'source' | 'embed'
  filename: string
  mime_type: string
  size: number
  created_at: string
}

export interface DocDetail {
  doc: {
    id: string
    kind: 'page' | 'upload'
    title: string
    content_html: string
    client_id: string | null
    version: number
    created_by: number
    created_at: string
    updated_at: string
    creator_name: string
    updater_name: string
  }
  files: DocFile[]
  permissions: { canDelete: boolean }
}

export type NotificationKind =
  | 'mention' | 'assignment' | 'status_change' | 'due_reminder' | 'change_request' | 'request_decision'

export interface NotificationItem {
  id: number
  kind: NotificationKind
  from_value: string | null
  to_value: string | null
  message: string
  read_at: string | null
  created_at: string
  actor_id: number | null
  actor_name: string | null
  task_id: number | null
  task_title: string | null
  task_due_date: string | null
}

export interface NotificationPage {
  items: NotificationItem[]
  hasMore: boolean
  unread: number
  latestId: number
}

export type NotificationPrefs = Record<
  'mentions' | 'assignments' | 'status_changes' | 'due_reminders' | 'change_requests' | 'request_decisions',
  boolean
>

export class ApiError extends Error {
  status: number
  // The response body, e.g. the current doc that came back with a 409.
  data: unknown
  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(res.status, data?.error ?? `${res.status} ${res.statusText}`, data)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

// Files go up as raw bytes; the backend's storeUpload() explains the fixed content type.
async function uploadRaw<T>(url: string, file: File): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
      'X-File-Type': file.type || 'application/octet-stream',
    },
    body: file,
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(res.status, data?.error ?? `${res.status} ${res.statusText}`, data)
  }
  return (await res.json()) as T
}

const get = <T,>(path: string) => request<T>('GET', path)

export const api = {
  me: () => get<Me>('/me'),
  switchWorkspace: (workspaceId: number) => request<Me>('PUT', '/me/workspace', { workspaceId }),
  createWorkspace: (name: string) => request<Me>('POST', '/workspaces', { name }),
  joinWorkspace: (code: string) => request<Me>('POST', '/workspaces/join', { code }),
  workspace: () =>
    get<{ workspace: Workspace & { invite_code: string }; members: Member[] }>('/workspace'),
  labels: () => get<{ labels: Label[] }>('/labels'),
  createLabel: (name: string, color: string) => request<{ label: Label }>('POST', '/labels', { name, color }),
  deleteLabel: (id: number) => request<void>('DELETE', `/labels/${id}`),
  dashboard: () => get<DashboardData>('/dashboard'),
  clients: () => get<{ clients: ClientSummary[] }>('/clients'),
  client: (id: string) => get<ClientDetail>(`/clients/${encodeURIComponent(id)}`),
  createClient: (input: ClientInput) => request<{ client: Client }>('POST', '/clients', input),
  updateClient: (id: string, input: ClientInput) =>
    request<{ client: Client }>('PUT', `/clients/${encodeURIComponent(id)}`, input),
  notifications: (q: { filter?: 'unread'; before?: number; after?: number; limit?: number } = {}) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v))
    const qs = params.toString()
    return get<NotificationPage>(`/notifications${qs ? `?${qs}` : ''}`)
  },
  markNotification: (id: number, read = true) => request<void>('POST', `/notifications/${id}/read`, { read }),
  markAllNotificationsRead: () => request<{ marked: number }>('POST', '/notifications/read-all'),
  notificationPrefs: () => get<{ prefs: NotificationPrefs }>('/notification-prefs'),
  updateNotificationPrefs: (changes: Partial<NotificationPrefs>) =>
    request<{ prefs: NotificationPrefs }>('PUT', '/notification-prefs', changes),
  board: () => get<BoardData>('/tasks'),
  task: (id: number) => get<TaskDetail>(`/tasks/${id}`),
  taskHistory: (id: number) => get<{ events: TaskEvent[] }>(`/tasks/${id}/history`),
  captureTasks: (input: { source: 'meeting' | 'personal'; date: string; titles: string[] }) =>
    request<{ tasks: BoardTask[] }>('POST', '/tasks/bulk', input),
  createTask: (input: TaskInput) => request<{ task: BoardTask }>('POST', '/tasks', input),
  updateTask: (id: number, input: TaskInput) => request<TaskDetail>('PATCH', `/tasks/${id}`, input),
  deleteTask: (id: number) => request<void>('DELETE', `/tasks/${id}`),
  addChecklistItem: (taskId: number, text: string) => request<TaskDetail>('POST', `/tasks/${taskId}/checklist`, { text }),
  setChecklistDone: (itemId: number, done: boolean) => request<TaskDetail>('PATCH', `/checklist/${itemId}`, { done }),
  deleteChecklistItem: (itemId: number) => request<TaskDetail>('DELETE', `/checklist/${itemId}`),
  addComment: (taskId: number, body: string) => request<TaskDetail>('POST', `/tasks/${taskId}/comments`, { body }),
  askToBeAssigned: (taskId: number) => request<TaskDetail>('POST', `/tasks/${taskId}/assign-requests`),
  resolveRequest: (requestId: number, status: 'approved' | 'rejected') =>
    request<TaskDetail>('PUT', `/change-requests/${requestId}`, { status }),
  deleteAttachment: (id: number) => request<TaskDetail>('DELETE', `/attachments/${id}`),
  attachmentUrl: (id: number) => `/api/attachments/${id}`,
  uploadAttachment: (taskId: number, file: File) => uploadRaw<TaskDetail>(`/api/tasks/${taskId}/attachments`, file),
  docs: () => get<{ docs: DocSummary[] }>('/docs'),
  doc: (id: string) => get<DocDetail>(`/docs/${encodeURIComponent(id)}`),
  createDoc: () => request<DocDetail>('POST', '/docs', {}),
  uploadDoc: (file: File) => uploadRaw<DocDetail>('/api/docs/upload', file),
  updateDoc: (id: string, input: { version: number; title?: string; client_id?: string | null; content_html?: string }) =>
    request<DocDetail>('PATCH', `/docs/${encodeURIComponent(id)}`, input),
  deleteDoc: (id: string) => request<void>('DELETE', `/docs/${encodeURIComponent(id)}`),
  uploadDocFile: (docId: string, file: File) =>
    uploadRaw<{ file: DocFile }>(`/api/docs/${encodeURIComponent(docId)}/files`, file),
  docFileUrl: (id: number, { inline = false } = {}) => `/api/doc-files/${id}${inline ? '?inline=1' : ''}`,
  deleteClient: (id: string) => request<void>('DELETE', `/clients/${encodeURIComponent(id)}`),
}
