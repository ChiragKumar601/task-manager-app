import { useEffect, useState } from 'react'
import { api, type NotificationPrefs } from '../../lib/api'
import { turnOffDesktop, turnOnDesktop, useDesktopState } from '../../lib/desktopNotifications'
import { PREF_OPTIONS } from '../../lib/notifications'

export function NotificationSettings() {
  const desktop = useDesktopState()
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    api.notificationPrefs().then((r) => setPrefs(r.prefs), (e: Error) => setError(e.message))
  }, [])

  // Saved straight away; the checkbox flips first and flips back if the save fails.
  const toggle = async (key: keyof NotificationPrefs, value: boolean) => {
    if (!prefs) return
    const before = prefs
    setPrefs({ ...prefs, [key]: value })
    setError(null)
    try {
      setPrefs((await api.updateNotificationPrefs({ [key]: value })).prefs)
    } catch (e) {
      setPrefs(before)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const turnOn = async () => {
    setAsking(true)
    await turnOnDesktop()
    setAsking(false)
  }

  return (
    <section className="card notif-settings" aria-label="Notification settings">
      <h2>Desktop notifications on this device</h2>
      <div className="desktop-row">
        {desktop === 'unsupported' && <span className="muted-text">This browser can’t show desktop notifications.</span>}
        {desktop === 'denied' && (
          <span className="muted-text">Notifications are blocked for this site. Allow them in your browser’s site settings, then reload.</span>
        )}
        {desktop === 'off' && (
          <>
            <button type="button" className="btn btn-primary btn-small" onClick={() => void turnOn()} disabled={asking}>
              {asking ? 'Waiting…' : 'Turn on'}
            </button>
            <span className="muted-text">Your browser will ask for permission.</span>
          </>
        )}
        {desktop === 'on' && (
          <>
            <span className="desktop-on">● On</span>
            <button type="button" className="btn btn-small" onClick={turnOffDesktop}>Turn off</button>
          </>
        )}
      </div>

      <h2>Show a desktop notification for</h2>
      <fieldset className="pref-list" disabled={!prefs}>
        <legend className="visually-hidden">Notification types</legend>
        {PREF_OPTIONS.map((o) => (
          <label key={o.key}>
            <input type="checkbox" checked={prefs?.[o.key] ?? true}
              onChange={(e) => void toggle(o.key, e.target.checked)} />
            {o.label}
          </label>
        ))}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="muted-text small">These apply on every device you turn on. Everything still shows up in your inbox.</p>
    </section>
  )
}
