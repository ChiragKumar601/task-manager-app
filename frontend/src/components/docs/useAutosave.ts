import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type DocDetail } from '../../lib/api'

export type DocFields = { title?: string; client_id?: string | null; content_html?: string }
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'

const DELAY_MS = 800

// Batches edits and saves them shortly after typing stops. Saves carry the doc's version;
// if someone else saved in between, the server answers 409 and we stop and ask.
export function useAutosave(docId: string, initialVersion: number, onSaved: (d: DocDetail) => void) {
  const [state, setState] = useState<SaveState>('saved')
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<DocDetail | null>(null)
  const version = useRef(initialVersion)
  const pending = useRef<DocFields>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)
  const blocked = useRef(false)
  const onSavedRef = useRef(onSaved)
  // flush() re-arms itself for edits made mid-save; going through a ref avoids a self-reference.
  const flushRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    onSavedRef.current = onSaved
  }, [onSaved])

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (inFlight.current || blocked.current) return
    const body = pending.current
    if (Object.keys(body).length === 0) return
    pending.current = {}
    inFlight.current = true
    setState('saving')
    try {
      const d = await api.updateDoc(docId, { ...body, version: version.current })
      version.current = d.doc.version
      onSavedRef.current(d)
      setError(null)
      setState(Object.keys(pending.current).length ? 'unsaved' : 'saved')
    } catch (e) {
      // Put the unsaved fields back underneath anything typed since.
      pending.current = { ...body, ...pending.current }
      if (e instanceof ApiError && e.status === 409) {
        blocked.current = true
        setConflict(e.data as DocDetail)
        setState('conflict')
      } else {
        setError(e instanceof Error ? e.message : String(e))
        setState('error')
      }
    } finally {
      inFlight.current = false
    }
    if (!blocked.current && Object.keys(pending.current).length && timer.current === null) {
      timer.current = setTimeout(() => void flushRef.current(), DELAY_MS)
    }
  }, [docId])

  useEffect(() => {
    flushRef.current = flush
  }, [flush])

  const schedule = useCallback((fields: DocFields, { immediate = false } = {}) => {
    pending.current = { ...pending.current, ...fields }
    if (blocked.current) return
    setState('unsaved')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), immediate ? 0 : DELAY_MS)
  }, [flush])

  // Conflict choices: take the other person's version, or save ours over it.
  const acceptTheirs = useCallback(() => {
    if (!conflict) return null
    pending.current = {}
    version.current = conflict.doc.version
    blocked.current = false
    setConflict(null)
    setState('saved')
    return conflict
  }, [conflict])

  const keepMine = useCallback(() => {
    if (!conflict) return
    version.current = conflict.doc.version
    blocked.current = false
    setConflict(null)
    void flush()
  }, [conflict, flush])

  // Warn before leaving with unsaved edits, and save whatever is queued when the page unmounts.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length || inFlight.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      void flush()
    }
  }, [flush])

  return { state, error, conflict, schedule, flush, acceptTheirs, keepMine }
}
