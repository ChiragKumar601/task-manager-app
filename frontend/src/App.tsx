import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { HomePage } from './components/HomePage'
import { ClientsPage } from './components/ClientsPage'
import { ClientDetailPage } from './components/ClientDetailPage'
import { SettingsPage } from './components/SettingsPage'
import { TasksPage } from './components/tasks/TasksPage'
import { CalendarPage } from './components/tasks/CalendarPage'
import { DocsPage } from './components/docs/DocsPage'
import { QuickCapturePage } from './components/tasks/QuickCapturePage'
import { InboxPage } from './components/inbox/InboxPage'
import { useNotificationFeed } from './lib/useNotificationFeed'
import { DocPage } from './components/docs/DocPage'
import { api, type Me } from './lib/api'
import { navItemFor } from './lib/nav'
import { navigate, usePath } from './lib/router'
import { useTheme } from './lib/theme'

function App() {
  const [theme, setTheme] = useTheme()
  const path = usePath()
  const [me, setMe] = useState<Me | null>(null)
  const feed = useNotificationFeed(me?.workspace.id)

  useEffect(() => {
    api.me().then(setMe, () => {})
  }, [])

  // /settings on its own has no page of its own yet — send it to the workspace tab.
  useEffect(() => {
    if (path === '/settings') navigate('/settings/workspace', { replace: true })
  }, [path])

  // Records like clients belong to one workspace, so leave any detail page on switch.
  const changeWorkspace = (next: Me) => {
    setMe(next)
    if (path.startsWith('/clients/')) navigate('/clients', { replace: true })
    if (path.startsWith('/tasks/')) navigate('/tasks', { replace: true })
    if (path.startsWith('/calendar/')) navigate('/calendar', { replace: true })
    if (path.startsWith('/docs/')) navigate('/docs', { replace: true })
  }

  const switchWorkspace = async (workspaceId: number) => {
    changeWorkspace(await api.switchWorkspace(workspaceId))
  }

  const isBoard = path === '/tasks' || /^\/tasks\/\d+$/.test(path)
  const isCalendar = path === '/calendar' || /^\/calendar\/\d+$/.test(path)

  const renderPage = () => {
    const user = me?.user ?? null
    if (path === '/') return <HomePage user={user} />
    if (path === '/clients') return <ClientsPage />
    // One element for the board and an open task, so the board keeps its state behind the panel.
    if (isBoard) return <TasksPage me={me} path={path} />
    if (isCalendar) return <CalendarPage me={me} path={path} />
    if (path === '/docs') return <DocsPage />
    if (path === '/capture') return <QuickCapturePage />
    if (path === '/inbox') return <InboxPage latestId={feed.latestId} onChanged={() => void feed.refresh()} />
    const docMatch = /^\/docs\/([^/]+)$/.exec(path)
    if (docMatch?.[1]) {
      const id = decodeURIComponent(docMatch[1])
      return <DocPage key={id} id={id} me={me} />
    }
    if (path === '/settings/workspace') {
      return <SettingsPage workspace={me?.workspace ?? null} onWorkspaceChange={changeWorkspace} />
    }

    const clientMatch = /^\/clients\/([^/]+)$/.exec(path)
    if (clientMatch?.[1]) {
      const id = decodeURIComponent(clientMatch[1])
      // key resets page state when moving between clients.
      return <ClientDetailPage key={id} id={id} />
    }

    const item = navItemFor(path)
    return (
      <div className="placeholder">
        <h1>{item?.label ?? 'Not found'}</h1>
        <p className="muted">{item ? 'This page isn’t built yet.' : 'There’s nothing at this address.'}</p>
      </div>
    )
  }

  return (
    <div className="app">
      <Sidebar
        me={me}
        onSwitchWorkspace={switchWorkspace}
        unread={feed.unread}
        active={navItemFor(path)}
        theme={theme}
        onThemeChange={setTheme}
      />
      {/* Keyed by workspace so every page refetches its data after a switch. */}
      <main className={`main${isBoard || isCalendar ? ' main-board' : ''}`} key={me?.workspace.id ?? 'loading'}>{renderPage()}</main>
    </div>
  )
}

export default App
