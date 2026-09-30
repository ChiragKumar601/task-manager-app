import { useEffect, useRef, useState } from 'react'
import { api, type DocSummary } from '../../lib/api'
import { fileKind, MAX_DOC_FILE_BYTES } from '../../lib/docs'
import { navigate } from '../../lib/router'
import { dbTime, formatBytes } from '../../lib/tasks'
import { Link } from '../Link'

export function DocsPage() {
  const [docs, setDocs] = useState<DocSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'new' | 'upload' | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.docs().then((r) => setDocs(r.docs), (e: Error) => setError(e.message))
  }, [])

  const newDoc = async () => {
    setBusy('new')
    setError(null)
    try {
      const { doc } = await api.createDoc()
      navigate(`/docs/${doc.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  const upload = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_DOC_FILE_BYTES) return setError(`${file.name} is over 10 MB.`)
    setBusy('upload')
    setError(null)
    try {
      const { doc } = await api.uploadDoc(file)
      navigate(`/docs/${doc.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  return (
    <div className="docs">
      <header className="toolbar">
        <h1>Docs</h1>
        <div className="toolbar-actions">
          <button type="button" className="btn" disabled={busy !== null} onClick={() => fileInput.current?.click()}>
            {busy === 'upload' ? 'Uploading…' : 'Upload document'}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void newDoc()}>
            {busy === 'new' ? 'Creating…' : '+ New doc'}
          </button>
          <input ref={fileInput} type="file" hidden onChange={(e) => {
            void upload(e.target.files?.[0])
            e.target.value = ''
          }} />
        </div>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}

      {docs && docs.length === 0 && (
        <p className="muted">No docs yet. Write one, or upload a file you already have.</p>
      )}

      {docs && docs.length > 0 && (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id}>
              <Link href={`/docs/${d.id}`} className="doc-row">
                {d.kind === 'upload' && <span className="file-badge">{fileKind(d.file_mime, d.title)}</span>}
                <span className="doc-title">{d.title}</span>
                {d.client_name && d.client_color && (
                  <span className="client-chip small-chip"
                    style={{ color: d.client_color, borderColor: d.client_color, background: `${d.client_color}1f` }}>
                    ● {d.client_name}
                  </span>
                )}
                <span className="doc-meta">
                  {d.kind === 'upload' && d.file_size !== null && `${formatBytes(d.file_size)} · `}
                  Updated {dbTime(d.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} by {d.updater_name}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
