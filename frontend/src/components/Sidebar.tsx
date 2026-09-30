import type { Me } from '../lib/api'
import type { ThemePreference } from '../lib/theme'
import { NAV_ITEMS, type NavItem } from '../lib/nav'
import { Link } from './Link'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

interface Props {
  me: Me | null
  onSwitchWorkspace: (workspaceId: number) => Promise<void>
  unread: number
  active: NavItem | undefined
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: string }[] = [
  { value: 'system', label: 'System', icon: '◐' },
  { value: 'light', label: 'Light', icon: '☀' },
  { value: 'dark', label: 'Dark', icon: '☾' },
]

export function Sidebar({ me, onSwitchWorkspace, unread, active, theme, onThemeChange }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="workspace-dot" aria-hidden="true" />
        <div className="workspace-info">
          <WorkspaceSwitcher me={me} onSwitch={onSwitchWorkspace} />
          <div className="workspace-email" title={me?.user.email}>{me?.user.email}</div>
        </div>
        <button type="button" className="link-button">Sign out</button>
      </div>

      <nav className="nav">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.path}
            href={item.path}
            className={`nav-item${item === active ? ' active' : ''}`}
            aria-current={item === active ? 'page' : undefined}
          >
            {item.label}
            {item.path === '/inbox' && unread > 0 && (
              <span className="nav-badge" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>
            )}
          </Link>
        ))}
      </nav>

      <div className="theme-switch" role="radiogroup" aria-label="Theme">
        {THEME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={theme === opt.value}
            className={theme === opt.value ? 'selected' : ''}
            onClick={() => onThemeChange(opt.value)}
          >
            <span aria-hidden="true">{opt.icon}</span> {opt.label}
          </button>
        ))}
      </div>
    </aside>
  )
}
