export const MAX_DOC_FILE_BYTES = 10 * 1024 * 1024

// A short label for a file type, e.g. "PDF" or "PNG".
export function fileKind(mime: string | null, filename = '') {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(filename)?.[1]
  if (ext) return ext.toUpperCase()
  if (!mime) return 'File'
  const sub = mime.split('/')[1] ?? mime
  return sub.replace(/^x-/, '').split(/[.+-]/)[0]!.toUpperCase()
}
