import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, type NotificationItem } from '../../lib/api'
import { relativeTime } from '../../lib/notifications'
import { navigate } from '../../lib/router'
import { dbTime, statusOf, todayIso } from '../../lib/tasks'
import { Avatar } from '../Avatar'
import { NotificationSettings } from './NotificationSettings'

type Filter = 'all' | 'unread'

const readFilter = (): Filter => (new URLSearchParams(window.location.search).get('filter') === 'unread' ? 'unread' : 'all')

function dueWhen(due: string | null) {
  if (!due) return 'is due soon'
  const today = todayIso()
  if (due < today) return 'is overdue'
  if (due === today) return 'is due today'
  return 'is due tomorrow'
}

// Actor and task in bold, the connecting words muted — as in "Karan Aneja assigned you to sample task".
function Sentence({ n }: { n: NotificationItem }) {
  const actor = <strong>{n.actor_name}</strong>
  const task = <strong>{n.task_title}</strong>
  const m = (text: string) => <span className="muted">{` ${text} `}</span>
  // Deleted tasks and very old rows fall back to the stored text.
  if (!n.task_title || (n.kind !== 'due_reminder' && !n.actor_name)) return <span>{n.message}</span>

  const parts: Record<NotificationItem['kind'], ReactNode> = {
    mention: <>{actor}{m('mentioned you on')}{task}</>,
    assignment: <>{actor}{m('assigned you to')}{task}</>,
    status_change: (
      <>{actor}{m('moved')}{task}{m('from')}{statusOf(n.from_value ?? '').label}{m('to')}{statusOf(n.to_value ?? '').label}</>
    ),
    due_reminder: <>{task}{m(dueWhen(n.to_value))}</>,
    change_request: <>{actor}{m('asked to be assigned to')}{task}</>,
    request_decision: (
      <>{actor}{m(n.to_value === 'approved' ? 'approved your request to be assigned to' : 'declined your request to be assigned to')}{task}</>
    ),
  }
  return <span>{parts[n.kind]}</span>
}

interface Props {
  // Bumps when the feed sees something new, so the list refreshes itself.
  latestId: number
  onChanged: () => void
}

export function InboxPage({ latestId, onChanged }: Props) {
  const [filter, setFilterState] = useState<Filter>(readFilter)
  const [items, setItems] = useState<NotificationItem[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // Ticks each minute so "3m" becomes "4m" without a reload.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const load = useCallback(async (f: Filter) => {
    try {
      const page = await api.notifications(f === 'unread' ? { filter: 'unread' } : {})
      setItems(page.items)
      setHasMore(page.hasMore)
      setUnread(page.unread)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    let active = true
    api.notifications(filter === 'unread' ? { filter: 'unread' } : {}).then((page) => {
      if (!active) return
      setItems(page.items)
      setHasMore(page.hasMore)
      setUnread(page.unread)
    }, (e: Error) => active && setError(e.message))
    return () => {
      active = false
    }
  }, [filter, latestId])

  const setFilter = (f: Filter) => {
    window.history.replaceState(null, '', f === 'unread' ? '/inbox?filter=unread' : '/inbox')
    setFilterState(f)
  }

  const loadMore = async () => {
    if (!items?.length) return
    setLoadingMore(true)
    try {
      const page = await api.notifications({ ...(filter === 'unread' ? { filter: 'unread' as const } : {}), before: items[items.length - 1]!.id })
      setItems([...items, ...page.items])
      setHasMore(page.hasMore)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
    }
  }

  const setRead = async (n: NotificationItem, read: boolean) => {
    setItems((list) => list?.map((x) => (x.id === n.id ? { ...x, read_at: read ? new Date().toISOString() : null } : x)) ?? null)
    setUnread((u) => Math.max(0, u + (read ? -1 : 1)))
    try {
      await api.markNotification(n.id, read)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      void load(filter)
    }
    onChanged()
  }

  const open = (n: NotificationItem) => {
    if (!n.read_at) void setRead(n, true)
    if (n.task_id && n.task_title) navigate(`/tasks/${n.task_id}`)
  }

  const markAll = async () => {
    try {
      await api.markAllNotificationsRead()
      await load(filter)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="inbox-page">
      <header className="board-toolbar">
        <div className="board-title">
          <h1>Inbox</h1>
          <div className="tabs" role="tablist" aria-label="Show">
            <button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'on' : ''}
              onClick={() => setFilter('all')}>All</button>
            <button type="button" role="tab" aria-selected={filter === 'unread'} className={filter === 'unread' ? 'on' : ''}
              onClick={() => setFilter('unread')}>Unread{unread > 0 ? ` · ${unread}` : ''}</button>
          </div>
        </div>
        <div className="board-filters">
          <button type="button" className="btn btn-small" onClick={() => void markAll()} disabled={unread === 0}>Mark all as read</button>
          <button type="button" className={`btn btn-small${showSettings ? ' btn-primary' : ''}`} aria-expanded={showSettings}
            onClick={() => setShowSettings((s) => !s)}>Notification settings</button>
        </div>
      </header>

      <div className="inbox-body">
        {showSettings && <NotificationSettings />}
        {error && <p className="form-error" role="alert">{error}</p>}

        {items && items.length === 0 && (
          <p className="muted inbox-empty">{filter === 'unread' ? 'No unread notifications.' : 'You’re all caught up — nothing here yet.'}</p>
        )}

        {items && items.length > 0 && (
          <ul className="notif-list">
            {items.map((n) => (
              <li key={n.id} className={`card notif${n.read_at ? '' : ' unread'}`}>
                <span className="unread-dot" aria-label={n.read_at ? undefined : 'Unread'} />
                {n.kind === 'due_reminder' || !n.actor_name
                  ? <span className="avatar avatar-empty notif-icon" aria-hidden="true">⏰</span>
                  : <Avatar name={n.actor_name} size={24} />}
                <button type="button" className="notif-text" onClick={() => open(n)}>
                  <Sentence n={n} />
                </button>
                <button type="button" className="link-button notif-toggle" onClick={() => void setRead(n, !n.read_at)}>
                  {n.read_at ? 'Mark unread' : 'Mark read'}
                </button>
                <time className="notif-time" dateTime={dbTime(n.created_at).toISOString()} title={dbTime(n.created_at).toLocaleString()}>
                  {relativeTime(dbTime(n.created_at), now)}
                </time>
              </li>
            ))}
          </ul>
        )}

        {hasMore && (
          <button type="button" className="btn btn-small load-more" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Show older'}
          </button>
        )}
      </div>
    </div>
  )
}
