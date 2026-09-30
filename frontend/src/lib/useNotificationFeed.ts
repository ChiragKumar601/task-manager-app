import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type NotificationItem } from './api'
import { getDesktopState } from './desktopNotifications'
import { prefKeyFor } from './notifications'
import { navigate } from './router'

const POLL_MS = 15_000

// Shows a pop-up for new notifications, but only while the app isn't the window in front —
// when you're looking at it, the inbox badge is enough.
async function showDesktop(items: NotificationItem[]) {
  if (getDesktopState() !== 'on' || (document.visibilityState === 'visible' && document.hasFocus())) return
  let prefs
  try {
    prefs = (await api.notificationPrefs()).prefs
  } catch {
    return
  }
  const wanted = items.filter((n) => {
    const key = prefKeyFor(n.kind)
    return key ? prefs[key] : false
  })
  // Oldest first, and never a flood: three, then one summary.
  const shown = [...wanted].reverse().slice(0, 3)
  for (const n of shown) {
    const popup = new Notification('Tasks', { body: n.message, tag: `notification-${n.id}` })
    popup.onclick = () => {
      window.focus()
      void api.markNotification(n.id).catch(() => {})
      if (n.task_id) navigate(`/tasks/${n.task_id}`)
      else navigate('/inbox')
      popup.close()
    }
  }
  if (wanted.length > shown.length) {
    const more = new Notification('Tasks', { body: `…and ${wanted.length - shown.length} more in your inbox`, tag: 'notification-more' })
    more.onclick = () => {
      window.focus()
      navigate('/inbox')
      more.close()
    }
  }
}

// Keeps the unread count fresh and raises desktop pop-ups for anything new.
export function useNotificationFeed(workspaceId: number | undefined) {
  const [summary, setSummary] = useState({ unread: 0, latestId: 0 })
  const lastSeen = useRef<number | null>(null)

  const poll = useCallback(async () => {
    if (workspaceId === undefined) return
    try {
      const first = lastSeen.current === null
      const page = await api.notifications(first ? { limit: 1 } : { after: lastSeen.current!, limit: 20 })
      if (!first && page.items.length) void showDesktop(page.items)
      lastSeen.current = Math.max(lastSeen.current ?? 0, page.latestId)
      setSummary({ unread: page.unread, latestId: page.latestId })
    } catch {
      // Try again next tick.
    }
  }, [workspaceId])

  useEffect(() => {
    lastSeen.current = null
    const kick = () => void poll()
    const first = setTimeout(kick, 0)
    const timer = setInterval(kick, POLL_MS)
    window.addEventListener('focus', kick)
    document.addEventListener('visibilitychange', kick)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      window.removeEventListener('focus', kick)
      document.removeEventListener('visibilitychange', kick)
    }
  }, [poll])

  return { ...summary, refresh: poll }
}
