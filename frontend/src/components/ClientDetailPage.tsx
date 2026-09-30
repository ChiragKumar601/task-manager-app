import { useEffect, useState } from 'react'
import { api, ApiError, type ClientDetail, type ClientInput } from '../lib/api'
import { formatDbDate } from '../lib/clients'
import { navigate } from '../lib/router'
import { ClientForm } from './ClientForm'
import { Link } from './Link'

function BackLink() {
  return <Link href="/clients" className="back-link">← Clients</Link>
}

export function ClientDetailPage({ id }: { id: string }) {
  const [data, setData] = useState<ClientDetail | null>(null)
  const [error, setError] = useState<{ status: number; message: string } | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let active = true
    api.client(id).then(
      (d) => active && setData(d),
      (e: Error) => active && setError({ status: e instanceof ApiError ? e.status : 0, message: e.message }),
    )
    return () => {
      active = false
    }
  }, [id])

  if (error) {
    return (
      <div className="client-detail">
        <BackLink />
        <div className="card panel">
          {error.status === 404 ? 'This client doesn’t exist or was deleted.' : `Couldn’t load client: ${error.message}`}
        </div>
      </div>
    )
  }

  if (!data) return <div className="client-detail"><BackLink /></div>

  const { client, tasks, docs } = data

  const handleSave = async (input: ClientInput) => {
    const { client: updated } = await api.updateClient(client.id, input)
    setData({ ...data, client: updated })
    setEditing(false)
  }

  const handleDelete = async () => {
    if (!window.confirm(`Delete “${client.name}”? Its tasks and docs will be kept but unlinked.`)) return
    setDeleting(true)
    try {
      await api.deleteClient(client.id)
      navigate('/clients', { replace: true })
    } catch (e) {
      setDeleting(false)
      window.alert(`Couldn’t delete client: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="client-detail">
      <BackLink />

      {editing ? (
        <ClientForm
          initial={{ name: client.name, email: client.email, phone: client.phone, notes: client.notes, color: client.color }}
          onSave={handleSave}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="card client-header">
          <div className="client-title">
            <span className="client-dot" style={{ background: client.color }} aria-hidden="true" />
            <h1>{client.name}</h1>
            <div className="client-actions">
              <button type="button" className="link-button" onClick={() => setEditing(true)}>Edit</button>
              <button type="button" className="link-button" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
          {(client.email || client.phone || client.notes) && (
            <dl className="client-meta">
              {client.email && (<><dt>Email</dt><dd><a href={`mailto:${client.email}`}>{client.email}</a></dd></>)}
              {client.phone && (<><dt>Phone</dt><dd><a href={`tel:${client.phone}`}>{client.phone}</a></dd></>)}
              {client.notes && (<><dt>Notes</dt><dd className="notes">{client.notes}</dd></>)}
            </dl>
          )}
        </div>
      )}

      <section className="detail-section">
        <div className="section-head">
          <h2>Tasks</h2>
          <Link href={`/tasks?client=${client.id}`} className="link-button">View in task board →</Link>
        </div>
        {tasks.length === 0 ? (
          <p className="muted">No tasks for this client yet.</p>
        ) : (
          <ul className="row-list">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link href={`/tasks/${t.id}`} className="card row row-link">
                <span>{t.title}</span>
                <span className="muted small">
                  {t.status_label}
                  {t.due_date && ` · Due ${new Date(`${t.due_date}T00:00:00`).toLocaleDateString()}`}
                </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail-section">
        <div className="section-head">
          <h2>Docs</h2>
        </div>
        {docs.length === 0 ? (
          <p className="muted">No docs for this client yet.</p>
        ) : (
          <ul className="row-list">
            {docs.map((d) => (
              <li key={d.id}>
                <Link href={`/docs/${d.id}`} className="card row row-link">
                  <span>{d.title}</span>
                  <span className="muted small">{formatDbDate(d.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
