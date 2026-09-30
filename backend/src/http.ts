import { randomBytes } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ErrorRequestHandler, Request, Response } from 'express';
import { UPLOADS_DIR } from './db.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Turns HttpErrors (and oversized uploads) into JSON responses. Express 5 forwards async throws here.
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if ((err as { type?: string }).type === 'entity.too.large') {
    const limit = (err as { limit?: number }).limit;
    return res.status(413).json({ error: limit ? `Files must be ${Math.round(limit / 1024 / 1024)} MB or smaller.` : 'That file is too large.' });
  }
  next(err);
};

export interface StoredUpload {
  filename: string;
  mime: string;
  size: number;
  key: string;
}

// Uploads arrive as raw bytes (always application/octet-stream so the JSON parser never touches
// them), with the real name and type in X-File-Name / X-File-Type. The bytes go to data/uploads/<key>.
export async function storeUpload(req: Request): Promise<StoredUpload> {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'The file is empty.');
  let filename = 'file';
  try {
    filename = decodeURIComponent(req.header('x-file-name') ?? 'file');
  } catch {
    // keep the fallback name
  }
  filename = filename.replace(/[\\/\r\n]/g, '_').slice(0, 200) || 'file';
  const mime = (req.header('x-file-type') || 'application/octet-stream').slice(0, 100);
  const key = randomBytes(16).toString('hex');
  await writeFile(resolve(UPLOADS_DIR, key), req.body);
  return { filename, mime, size: req.body.length, key };
}

export async function removeUploads(keys: string[]) {
  await Promise.all(keys.map((k) => unlink(resolve(UPLOADS_DIR, k)).catch(() => {})));
}

// Types a browser can show without running anything from our origin.
const INLINE_SAFE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain']);

// Streams a stored file. Downloads by default; `inline` only applies to the safe types above.
export function sendUpload(res: Response, file: { filename: string; mime_type: string; size: number; storage_key: string }, inline = false) {
  const showInline = inline && INLINE_SAFE.has(file.mime_type);
  res.setHeader('Content-Type', showInline ? file.mime_type : 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', `${showInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
  res.sendFile(resolve(UPLOADS_DIR, file.storage_key), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File is missing' });
  });
}
