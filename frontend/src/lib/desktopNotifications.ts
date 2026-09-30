import { useSyncExternalStore } from 'react'

// Desktop pop-ups are switched on per device (the browser permission is per device too),
// while *which* kinds pop up is a per-user setting stored on the server.

export type DesktopState = 'unsupported' | 'denied' | 'on' | 'off'

const KEY = 'desktop-notifications'
const listeners = new Set<() => void>()

const supported = () => typeof window !== 'undefined' && 'Notification' in window

function readFlag() {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

function writeFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, 'on')
    else localStorage.removeItem(KEY)
  } catch {
    // Without storage the setting just won't survive a reload.
  }
}

export function getDesktopState(): DesktopState {
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.permission === 'granted' && readFlag() ? 'on' : 'off'
}

const emit = () => listeners.forEach((l) => l())

export async function turnOnDesktop() {
  if (!supported()) return getDesktopState()
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  writeFlag(permission === 'granted')
  emit()
  return getDesktopState()
}

export function turnOffDesktop() {
  writeFlag(false)
  emit()
}

export function useDesktopState() {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      window.addEventListener('storage', onChange)
      return () => {
        listeners.delete(onChange)
        window.removeEventListener('storage', onChange)
      }
    },
    getDesktopState,
    () => 'unsupported' as DesktopState,
  )
}
