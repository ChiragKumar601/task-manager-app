import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api, type ClientSummary, type Label, type Me, type Member, type Workspace } from '../lib/api'
import { CLIENT_COLORS, DEFAULT_CLIENT_COLOR } from '../lib/clients'
import { LABEL_COLORS, readableTextOn } from '../lib/labels'
import { ColorSwatches } from './ColorSwatches'
import { Avatar } from './Avatar'
import { Link } from './Link'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Shared busy/error handling for the small inline forms on this page.
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="settings-section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function FormError({ error }: { error: string | null }) {
  return error ? <p className="form-error" role="alert">{error}</p> : null
}

function CreateWorkspace({ onWorkspaceChange }: { onWorkspaceChange: (me: Me) => void }) {
  const [name, setName] = useState('')
  const { busy, error, run } = useAction()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => onWorkspaceChange(await api.createWorkspace(name.trim())))
  }

  return (
    <Section title="Create a new workspace">
      <p className="muted-text">You’ll be its owner. Switch between your workspaces from the name at the top left.</p>
      <form className="inline-form" onSubmit={submit}>
        <input className="input" placeholder="Workspace name" value={name} maxLength={80}
          onChange={(e) => setName(e.target.value)} aria-label="Workspace name" />
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
      <FormError error={error} />
    </Section>
  )
}

function JoinWorkspace({ onWorkspaceChange }: { onWorkspaceChange: (me: Me) => void }) {
  const [code, setCode] = useState('')
  const { busy, error, setError, run } = useAction()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!code.trim()) {
      setError('Enter an invite code.')
      return
    }
    void run(async () => onWorkspaceChange(await api.joinWorkspace(code.trim())))
  }

  return (
    <Section title="Join another workspace">
      <p className="muted-text">
        Got an invite code from another team? Join it without leaving this one — you can switch between
        workspaces from the sidebar.
      </p>
      <form className="inline-form" onSubmit={submit}>
        <input className="input" placeholder="Invite code" value={code}
          onChange={(e) => setCode(e.target.value)} aria-label="Invite code" autoCapitalize="characters" />
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Joining…' : 'Join workspace'}
        </button>
      </form>
      <FormError error={error} />
    </Section>
  )
}

function Members({ members, inviteCode }: { members: Member[]; inviteCode: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be blocked; the code is on screen to copy by hand.
    }
  }

  return (
    <Section title="Members">
      <ul className="member-list">
        {members.map((m) => (
          <li key={m.id}>
            <Avatar name={m.name} />
            <div>
              <div>{m.name}</div>
              <div className="role">{m.role}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="muted-text small invite-line">
        Invite people with the code <code className="invite-code">{inviteCode}</code>
        <button type="button" className="link-button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </p>
    </Section>
  )
}

function Clients({ focusOnLoad }: { focusOnLoad: boolean }) {
  const [clients, setClients] = useState<ClientSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [color, setColor] = useState(DEFAULT_CLIENT_COLOR)
  const { busy, error, setError, run } = useAction()
  const nameRef = useRef<HTMLInputElement>(null)

  const load = () => api.clients().then((r) => setClients(r.clients), (e: Error) => setLoadError(e.message))

  useEffect(() => {
    void load()
  }, [])

  // Arriving from "+ Add client" on the clients page lands on this form.
  useEffect(() => {
    if (!focusOnLoad || !clients) return
    nameRef.current?.closest('section')?.scrollIntoView({ block: 'start' })
    nameRef.current?.focus({ preventScroll: true })
  }, [focusOnLoad, clients])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Client name is required.')
      return
    }
    void run(async () => {
      await api.createClient({ name, email, phone, notes: '', color })
      setName('')
      setEmail('')
      setPhone('')
      await load()
      nameRef.current?.focus()
    })
  }

  const remove = (c: ClientSummary) => {
    if (!window.confirm(`Remove “${c.name}”? Its tasks and docs will be kept but unlinked.`)) return
    void run(async () => {
      await api.deleteClient(c.id)
      setClients((list) => list?.filter((x) => x.id !== c.id) ?? null)
    })
  }

  return (
    <Section id="clients" title="Clients">
      {loadError && <FormError error={`Couldn’t load clients: ${loadError}`} />}
      {clients && clients.length === 0 && <p className="muted-text">No clients yet.</p>}
      {clients && clients.length > 0 && (
        <ul className="chip-list">
          {clients.map((c) => (
            <li key={c.id}>
              <Link href={`/clients/${c.id}`} className="client-chip"
                style={{ color: c.color, borderColor: c.color, background: `${c.color}1f` }}>
                ● {c.name}
              </Link>
              <button type="button" className="link-button" onClick={() => remove(c)} disabled={busy}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      <form className="client-add" onSubmit={submit} noValidate>
        <input ref={nameRef} className="input" placeholder="Client name" value={name} maxLength={120}
          onChange={(e) => setName(e.target.value)} aria-label="Client name" />
        <input className="input" type="email" placeholder="Email (optional)" value={email}
          onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
        <input className="input" type="tel" placeholder="Phone (optional)" value={phone} maxLength={40}
          onChange={(e) => setPhone(e.target.value)} aria-label="Phone" />
        <div className="client-add-end">
          <ColorSwatches colors={CLIENT_COLORS} value={color} onChange={setColor} label="Client color" />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Adding…' : 'Add client'}
          </button>
        </div>
      </form>
      <FormError error={error} />
    </Section>
  )
}

function Labels() {
  const [labels, setLabels] = useState<Label[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(LABEL_COLORS[0] ?? '#ef4444')
  const { busy, error, setError, run } = useAction()

  useEffect(() => {
    api.labels().then((r) => setLabels(r.labels), (e: Error) => setLoadError(e.message))
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Label name is required.')
      return
    }
    void run(async () => {
      const { label } = await api.createLabel(name.trim(), color)
      setLabels((list) => [...(list ?? []), label])
      setName('')
    })
  }

  const remove = (l: Label) => {
    if (!window.confirm(`Remove the label “${l.name}”? It will be taken off every task that has it.`)) return
    void run(async () => {
      await api.deleteLabel(l.id)
      setLabels((list) => list?.filter((x) => x.id !== l.id) ?? null)
    })
  }

  return (
    <Section title="Labels">
      {loadError && <FormError error={`Couldn’t load labels: ${loadError}`} />}
      {labels && labels.length === 0 && <p className="muted-text">No labels yet.</p>}
      {labels && labels.length > 0 && (
        <ul className="chip-list">
          {labels.map((l) => (
            <li key={l.id}>
              <span className="label-chip" style={{ background: l.color, color: readableTextOn(l.color) }}>{l.name}</span>
              <button type="button" className="link-button" onClick={() => remove(l)} disabled={busy}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      <form className="inline-form" onSubmit={submit} noValidate>
        <input className="input" placeholder="Label name" value={name} maxLength={40}
          onChange={(e) => setName(e.target.value)} aria-label="Label name" />
        <select className="input color-select" value={color} onChange={(e) => setColor(e.target.value)}
          style={{ color }} aria-label="Label color">
          {LABEL_COLORS.map((c) => (
            <option key={c} value={c} style={{ color: c }}>● {c}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add label'}
        </button>
      </form>
      <FormError error={error} />
    </Section>
  )
}

interface Props {
  workspace: Workspace | null
  onWorkspaceChange: (me: Me) => void
}

export function SettingsPage({ workspace, onWorkspaceChange }: Props) {
  const [data, setData] = useState<{ members: Member[]; inviteCode: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [focusClients] = useState(() => window.location.hash === '#clients')

  useEffect(() => {
    api.workspace().then(
      (r) => setData({ members: r.members, inviteCode: r.workspace.invite_code }),
      (e: Error) => setError(e.message),
    )
  }, [])

  return (
    <div className="settings">
      <header className="page-header">
        <h1>Workspace settings</h1>
        <p className="muted">{workspace?.name}</p>
      </header>

      {error && <div className="card error">Couldn’t load workspace: {error}</div>}

      <CreateWorkspace onWorkspaceChange={onWorkspaceChange} />
      <JoinWorkspace onWorkspaceChange={onWorkspaceChange} />
      {data && <Members members={data.members} inviteCode={data.inviteCode} />}
      <Clients focusOnLoad={focusClients} />
      <Labels />
    </div>
  )
}
