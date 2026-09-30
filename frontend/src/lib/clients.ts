// Keep in sync with CLIENT_COLORS in backend/src/clients.ts.
export const CLIENT_COLORS = [
  '#4f46e5', '#16a34a', '#ea7a0c', '#e11d48', '#a21caf',
  '#0891b2', '#db2777', '#22c55e', '#f04f12', '#7a1ef0',
]

export const DEFAULT_CLIENT_COLOR = '#7a1ef0'

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// SQLite datetime('now') values are UTC without a zone marker.
export function formatDbDate(value: string) {
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleDateString()
}
