import DOMPurify from 'dompurify'

// Doc HTML is written by any member and shown to everyone, so it's sanitized every time it
// is loaded into the editor and again before it's saved. Only what the toolbar can produce survives.
const ALLOWED_TAGS = ['p', 'br', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'blockquote', 'div', 'span', 'code', 'pre']
const ALLOWED_ATTR = ['href', 'class', 'contenteditable', 'data-task-id', 'data-file-id', 'data-status', 'target', 'rel']
const ALLOWED_CLASSES = new Set(['doc-task', 'doc-file'])

// Only our own task/file links, or ordinary web links (opened in a new tab).
const INTERNAL_HREF = /^\/(tasks\/\d+|api\/doc-files\/\d+)$/

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.hasAttribute('class')) {
    const kept = [...node.classList].filter((c) => ALLOWED_CLASSES.has(c))
    if (kept.length) node.setAttribute('class', kept.join(' '))
    else node.removeAttribute('class')
  }
  if (node.getAttribute('contenteditable') !== null && node.getAttribute('contenteditable') !== 'false') {
    node.removeAttribute('contenteditable')
  }
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? ''
    if (/^https?:\/\//i.test(href)) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    } else if (!INTERNAL_HREF.test(href)) {
      node.removeAttribute('href')
      node.removeAttribute('target')
    }
  }
})

export function sanitizeDocHtml(html: string) {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false })
}

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}
