export interface NavItem {
  label: string
  path: string
  // URL prefix the item owns, when it differs from the link target.
  section?: string
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', path: '/' },
  { label: 'Inbox', path: '/inbox' },
  { label: 'Tasks', path: '/tasks' },
  { label: 'Calendar', path: '/calendar' },
  { label: 'Docs', path: '/docs' },
  { label: 'Clients', path: '/clients' },
  { label: 'Quick Capture', path: '/capture' },
  { label: 'Settings', path: '/settings/workspace', section: '/settings' },
]

// The nav item a path belongs to, e.g. "/clients/abc" → Clients.
export function navItemFor(path: string): NavItem | undefined {
  if (path === '/') return NAV_ITEMS[0]
  return NAV_ITEMS.find((item) => {
    const prefix = item.section ?? item.path
    return prefix !== '/' && (path === prefix || path.startsWith(`${prefix}/`))
  })
}
