const AVATAR_COLORS = ['#6d5bd0', '#9d1ab8', '#0e7490', '#b45309', '#15803d', '#be185d']

// A stable color per name, so a person looks the same everywhere.
function avatarColor(name: string) {
  const hash = [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0)
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ background: avatarColor(name), width: size, height: size, fontSize: Math.round(size * 0.46) }}
      title={name}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  )
}
