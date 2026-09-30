import { useEffect, useState } from 'react'
import { api, type ClientSummary } from '../lib/api'
import { plural } from '../lib/clients'
import { Link } from './Link'

export function ClientsPage() {
  const [clients, setClients] = useState<ClientSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.clients().then((r) => setClients(r.clients), (e: Error) => setError(e.message))
  }, [])

  return (
    <div className="clients">
      <header className="toolbar">
        <h1>Clients</h1>
        <Link href="/settings/workspace#clients" className="btn btn-primary">+ Add client</Link>
      </header>

      {error && <div className="card error">Couldn’t load clients: {error}</div>}

      {clients && clients.length === 0 && (
        <p className="muted">No clients yet. Add one to start grouping tasks and docs.</p>
      )}

      {clients && clients.length > 0 && (
        <ul className="client-list">
          {clients.map((c) => (
            <li key={c.id}>
              <Link href={`/clients/${c.id}`} className="card client-row">
                <span className="client-dot" style={{ background: c.color }} aria-hidden="true" />
                <span className="client-name">{c.name}</span>
                <span className="client-counts">
                  <span>{plural(c.task_count, 'task')}</span>
                  <span>{plural(c.doc_count, 'doc')}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
