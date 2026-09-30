import type { BoardMember, Label } from '../../lib/api'
import { Avatar } from '../Avatar'

const toggle = (ids: number[], id: number) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])

interface PickerProps<T> {
  options: T[]
  value: number[]
  onChange: (ids: number[]) => void
  disabled?: boolean
}

export function AssigneePicker({ options, value, onChange, disabled }: PickerProps<BoardMember>) {
  return (
    <div className="chip-picker" role="group" aria-label="Assignees">
      {options.map((m) => {
        const on = value.includes(m.id)
        return (
          <button key={m.id} type="button" className={`person-chip${on ? ' on' : ''}`} aria-pressed={on}
            disabled={disabled} onClick={() => onChange(toggle(value, m.id))}>
            <Avatar name={m.name} size={18} />
            {m.name}
          </button>
        )
      })}
    </div>
  )
}

export function LabelPicker({ options, value, onChange, disabled }: PickerProps<Label>) {
  if (options.length === 0) return <p className="muted-text">No labels yet — add some in Settings.</p>
  return (
    <div className="chip-picker" role="group" aria-label="Labels">
      {options.map((l) => {
        const on = value.includes(l.id)
        return (
          <button key={l.id} type="button" className={`label-toggle${on ? ' on' : ''}`} aria-pressed={on}
            disabled={disabled} onClick={() => onChange(toggle(value, l.id))}
            style={{ background: `${l.color}${on ? '' : '33'}`, color: on ? '#fff' : l.color }}>
            {l.name}
          </button>
        )
      })}
    </div>
  )
}
