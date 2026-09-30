interface Props {
  colors: string[]
  value: string
  onChange: (color: string) => void
  label?: string
}

export function ColorSwatches({ colors, value, onChange, label = 'Color' }: Props) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          className={`swatch${value === color ? ' selected' : ''}`}
          style={{ background: color, color }}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}
