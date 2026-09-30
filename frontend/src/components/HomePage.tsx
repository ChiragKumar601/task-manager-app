import { useEffect, useState } from 'react'
import { api, type DashboardData, type User } from '../lib/api'
import { Link } from './Link'

function greeting(date: Date) {
  const h = date.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function formatDue(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function StatCard({ label, value, hint, href }: { label: string; value: number | string; hint: string; href: string }) {
  return (
    <Link href={href} className="card stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-hint">{hint}</span>
    </Link>
  )
}

function BarList({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <ul className="bar-list">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `calc((100% - 2.5rem) * ${r.count / max})` }}
            />
            <span className="bar-count">{r.count}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function HomePage({ user }: { user: User | null }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const now = new Date()
  const firstName = user?.name.split(' ')[0] ?? ''

  useEffect(() => {
    api.dashboard().then(setData, (e: Error) => setError(e.message))
  }, [])

  const stats = data?.stats
  const v = (n: number | undefined) => n ?? '–'

  return (
    <div className="home">
      <header className="page-header">
        <h1>{greeting(now)}{firstName && `, ${firstName}`}</h1>
        <p className="muted">
          {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          {' · '}here’s where things stand.
        </p>
      </header>

      {error && <div className="card error">Couldn’t load the dashboard: {error}</div>}

      <section className="stat-grid">
        <StatCard label="My open tasks" value={v(stats?.myOpenTasks)} hint="Assigned to you" href="/tasks?assignee=me" />
        <StatCard label="Overdue" value={v(stats?.overdue)} hint="Past their due date" href="/tasks?assignee=me" />
        <StatCard label="Due this week" value={v(stats?.dueThisWeek)} hint="In the next 7 days" href="/calendar" />
        <StatCard label="Awaiting your review" value={v(stats?.awaitingReview)} hint="Change requests" href="/tasks" />
        <StatCard label="Unread in inbox" value={v(stats?.unreadInbox)} hint="Mentions, assignments, updates" href="/inbox?filter=unread" />
      </section>

      <section className="two-col">
        <div className="card panel">
          <h2>Due soon — assigned to you</h2>
          {data && data.dueSoon.length === 0 && (
            <p className="muted">Nothing overdue or due this week.</p>
          )}
          {data && data.dueSoon.length > 0 && (
            <ul className="item-list">
              {data.dueSoon.map((t) => (
                <li key={t.id}>
                  <span>{t.title}</span>
                  <span className={t.is_overdue ? 'due overdue' : 'due'}>
                    {t.is_overdue ? 'Overdue · ' : ''}{formatDue(t.due_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card panel">
          <h2>Waiting for your review</h2>
          {data && data.reviews.length === 0 && (
            <p className="muted">No change requests on tasks you manage.</p>
          )}
          {data && data.reviews.length > 0 && (
            <ul className="item-list">
              {data.reviews.map((r) => (
                <li key={r.id}>
                  <span>{r.task_title}</span>
                  <span className="muted small">by {r.requested_by}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="two-col">
        <div className="card panel">
          <h2>All tasks by status</h2>
          {data && <BarList rows={data.byStatus} />}
        </div>

        <div className="card panel">
          <h2>Open tasks per person</h2>
          {data && (
            <>
              {data.byPerson.length > 0 ? (
                <BarList rows={data.byPerson.map((p) => ({ label: p.name, count: p.count }))} />
              ) : (
                <p className="muted">No open tasks are assigned yet.</p>
              )}
              {data.unassignedOpen > 0 && (
                <p className="muted small footnote">
                  Plus {data.unassignedOpen} open task{data.unassignedOpen === 1 ? '' : 's'} with nobody assigned.
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  )
}
