import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type MouseEvent } from 'react'
import { sanitizeDocHtml } from '../../lib/sanitize'

export interface DocEditorHandle {
  // Inserts HTML where the caret was last in the editor (or at the end).
  insertHtml: (html: string) => void
  // Replaces everything, e.g. after taking someone else's version.
  setHtml: (html: string) => void
  focus: () => void
  root: () => HTMLDivElement | null
}

interface Props {
  initialHtml: string
  onChange: (html: string) => void
  onOpenTask: (id: number) => void
  onOpenFile: (id: number) => void
  toolbarExtras: React.ReactNode
}

type Command = 'bold' | 'italic' | 'h2' | 'list'

// A small rich-text editor on contentEditable. Formatting uses document.execCommand, which is
// deprecated but still supported everywhere and keeps native undo/redo working.
export const DocEditor = forwardRef<DocEditorHandle, Props>(function DocEditor(
  { initialHtml, onChange, onOpenTask, onOpenFile, toolbarExtras },
  ref,
) {
  const editor = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const [active, setActive] = useState<Record<Command, boolean>>({ bold: false, italic: false, h2: false, list: false })
  const [empty, setEmpty] = useState(true)

  const emit = useCallback(() => {
    const el = editor.current
    if (!el) return
    setEmpty(!el.textContent?.trim() && !el.querySelector('a, li'))
    onChange(sanitizeDocHtml(el.innerHTML))
  }, [onChange])

  useEffect(() => {
    const el = editor.current
    if (!el) return
    el.innerHTML = sanitizeDocHtml(initialHtml)
    setEmpty(!el.textContent?.trim() && !el.querySelector('a, li'))
    // Only on mount: after that the DOM is the source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Remember where the caret is, and reflect bold/italic/etc. in the toolbar.
  useEffect(() => {
    const onSelection = () => {
      const sel = document.getSelection()
      const el = editor.current
      if (!sel || !el || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return
      savedRange.current = sel.getRangeAt(0).cloneRange()
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        h2: document.queryCommandValue('formatBlock').toLowerCase() === 'h2',
        list: document.queryCommandState('insertUnorderedList'),
      })
    }
    document.addEventListener('selectionchange', onSelection)
    return () => document.removeEventListener('selectionchange', onSelection)
  }, [])

  // Puts the caret back where it last was in the editor. If the caret is already in the
  // editor (the toolbar never steals focus) the live selection wins — the saved one can lag.
  const restoreSelection = () => {
    const el = editor.current
    if (!el) return
    const sel = document.getSelection()
    if (!sel) return
    if (document.activeElement === el && sel.rangeCount > 0 && el.contains(sel.anchorNode)) return
    el.focus()
    sel.removeAllRanges()
    if (savedRange.current && el.contains(savedRange.current.startContainer)) {
      sel.addRange(savedRange.current)
    } else {
      const r = document.createRange()
      r.selectNodeContents(el)
      r.collapse(false)
      sel.addRange(r)
    }
  }

  useImperativeHandle(ref, () => ({
    insertHtml: (html) => {
      restoreSelection()
      document.execCommand('insertHTML', false, sanitizeDocHtml(html))
      emit()
    },
    setHtml: (html) => {
      if (editor.current) editor.current.innerHTML = sanitizeDocHtml(html)
      savedRange.current = null
      setEmpty(!editor.current?.textContent?.trim())
    },
    focus: () => restoreSelection(),
    root: () => editor.current,
  }), [emit])

  const run = (command: Command) => {
    restoreSelection()
    document.execCommand('defaultParagraphSeparator', false, 'p')
    if (command === 'bold') document.execCommand('bold')
    if (command === 'italic') document.execCommand('italic')
    if (command === 'list') document.execCommand('insertUnorderedList')
    if (command === 'h2') {
      const current = document.queryCommandValue('formatBlock').toLowerCase()
      document.execCommand('formatBlock', false, current === 'h2' ? 'p' : 'h2')
    }
    emit()
  }

  // Task and file chips are links; clicking one opens it instead of placing the caret.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest('a')
    if (!link) return
    if (link.dataset.taskId) {
      e.preventDefault()
      onOpenTask(Number(link.dataset.taskId))
    } else if (link.dataset.fileId) {
      e.preventDefault()
      onOpenFile(Number(link.dataset.fileId))
    } else if (link.href && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      window.open(link.href, '_blank', 'noopener,noreferrer')
    }
  }

  const tool = (command: Command, label: string, title: string, className = '') => (
    <button type="button" className={`tool ${className}${active[command] ? ' on' : ''}`} aria-pressed={active[command]}
      title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => run(command)}>
      {label}
    </button>
  )

  return (
    <div className="doc-editor-wrap">
      <div className="doc-toolbar" role="toolbar" aria-label="Formatting">
        {tool('bold', 'B', 'Bold (Ctrl+B)', 'tool-bold')}
        {tool('italic', 'I', 'Italic (Ctrl+I)', 'tool-italic')}
        {tool('h2', 'H2', 'Heading')}
        {tool('list', 'List', 'Bulleted list')}
        {toolbarExtras}
      </div>
      <div
        ref={editor}
        className={`doc-editor${empty ? ' is-empty' : ''}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Doc content"
        data-placeholder="Start writing…"
        onInput={emit}
        onClick={onClick}
        onPaste={(e) => {
          // Keep formatting we support, drop everything else (styles, scripts, tracking pixels).
          e.preventDefault()
          const html = e.clipboardData.getData('text/html')
          const text = e.clipboardData.getData('text/plain')
          if (html) document.execCommand('insertHTML', false, sanitizeDocHtml(html))
          else document.execCommand('insertText', false, text)
          emit()
        }}
      />
    </div>
  )
})
