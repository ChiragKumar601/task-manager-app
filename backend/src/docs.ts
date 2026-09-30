import express, { Router, type Response } from 'express';
import type { Router as ExpressRouter } from 'express';
import { currentUser, type CurrentUser } from './auth.js';
import { db, newPublicId, transaction } from './db.js';
import { HttpError, removeUploads, sendUpload, storeUpload } from './http.js';

export const MAX_DOC_FILE_BYTES = 10 * 1024 * 1024;
const MAX_CONTENT_CHARS = 500_000;

interface DocRow {
  id: string;
  workspace_id: number;
  client_id: string | null;
  kind: 'page' | 'upload';
  title: string;
  content_html: string;
  version: number;
  created_by: number;
}

const user = (res: Response) => res.locals.user as CurrentUser;

function findDoc(id: string, ws: number): DocRow {
  const doc = db.prepare('SELECT * FROM docs WHERE id = ? AND workspace_id = ?').get(id, ws) as unknown as DocRow | undefined;
  if (!doc) throw new HttpError(404, 'Doc not found');
  return doc;
}

const isOwner = (userId: number, ws: number) =>
  !!db.prepare("SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ? AND role = 'owner'").get(ws, userId);

function checkClient(value: unknown, ws: number): string | null {
  if (value === null || value === '' || value === undefined) return null;
  if (typeof value === 'string' && db.prepare('SELECT 1 FROM clients WHERE id = ? AND workspace_id = ?').get(value, ws)) return value;
  throw new HttpError(400, 'That client isn’t in this workspace.');
}

function checkTitle(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'Title must be text.');
  const title = value.trim() || 'Untitled';
  if (title.length > 200) throw new HttpError(400, 'Title must be 200 characters or fewer.');
  return title;
}

const FILE_COLUMNS = 'id, role, filename, mime_type, size, created_at';

function docDetail(id: string, u: CurrentUser) {
  const doc = db.prepare(`
    SELECT d.id, d.kind, d.title, d.content_html, d.client_id, d.version, d.created_by, d.created_at, d.updated_at,
           cu.name AS creator_name, uu.name AS updater_name
      FROM docs d JOIN users cu ON cu.id = d.created_by JOIN users uu ON uu.id = d.updated_by
     WHERE d.id = ?
  `).get(id) as { created_by: number } & Record<string, unknown>;
  const files = db.prepare(`SELECT ${FILE_COLUMNS} FROM doc_files WHERE doc_id = ? ORDER BY created_at, id`).all(id);
  return {
    doc,
    files,
    permissions: { canDelete: doc.created_by === u.id || isOwner(u.id, u.workspace_id) },
  };
}

export function docsRouter(): ExpressRouter {
  const router = Router();

  router.use((req, res, next) => {
    const u = currentUser(req);
    if (!u) return res.status(404).json({ error: 'No users' });
    res.locals.user = u;
    next();
  });

  router.get('/docs', (_req, res) => {
    const docs = db.prepare(`
      SELECT d.id, d.kind, d.title, d.client_id, c.name AS client_name, c.color AS client_color,
             d.updated_at, u.name AS updater_name,
             f.mime_type AS file_mime, f.size AS file_size
        FROM docs d
        JOIN users u ON u.id = d.updated_by
        LEFT JOIN clients c ON c.id = d.client_id
        LEFT JOIN doc_files f ON f.doc_id = d.id AND f.role = 'source'
       WHERE d.workspace_id = ?
       ORDER BY d.updated_at DESC, d.title
    `).all(user(res).workspace_id);
    res.json({ docs });
  });

  // A new, empty page doc.
  router.post('/docs', (req, res) => {
    const u = user(res);
    const title = req.body?.title === undefined ? 'Untitled' : checkTitle(req.body.title);
    const clientId = checkClient(req.body?.client_id, u.workspace_id);
    const id = newPublicId();
    db.prepare(`
      INSERT INTO docs (id, workspace_id, client_id, kind, title, created_by, updated_by) VALUES (?, ?, ?, 'page', ?, ?, ?)
    `).run(id, u.workspace_id, clientId, title, u.id, u.id);
    res.status(201).json(docDetail(id, u));
  });

  // "Upload document": the file becomes a doc of its own, titled after the file.
  router.post('/docs/upload', express.raw({ type: 'application/octet-stream', limit: MAX_DOC_FILE_BYTES }), async (req, res) => {
    const u = user(res);
    const clientId = checkClient(req.query.client_id, u.workspace_id);
    const file = await storeUpload(req);
    const id = newPublicId();
    const title = file.filename.replace(/\.[^.]+$/, '').slice(0, 200) || file.filename;
    try {
      transaction(() => {
        db.prepare(`
          INSERT INTO docs (id, workspace_id, client_id, kind, title, created_by, updated_by) VALUES (?, ?, ?, 'upload', ?, ?, ?)
        `).run(id, u.workspace_id, clientId, title, u.id, u.id);
        db.prepare(`
          INSERT INTO doc_files (doc_id, role, uploaded_by, filename, mime_type, size, storage_key) VALUES (?, 'source', ?, ?, ?, ?, ?)
        `).run(id, u.id, file.filename, file.mime, file.size, file.key);
      });
    } catch (e) {
      await removeUploads([file.key]);
      throw e;
    }
    res.status(201).json(docDetail(id, u));
  });

  router.get('/docs/:id', (req, res) => {
    const doc = findDoc(req.params.id, user(res).workspace_id);
    res.json(docDetail(doc.id, user(res)));
  });

  // Autosave target. `version` must match the stored one, so two people editing at once
  // can't silently overwrite each other; a mismatch returns 409 with the current doc.
  router.patch('/docs/:id', (req, res) => {
    const u = user(res);
    const doc = findDoc(req.params.id, u.workspace_id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (b.version !== doc.version) {
      return res.status(409).json({ error: 'Someone else changed this doc since you opened it.', ...docDetail(doc.id, u) });
    }

    const sets: string[] = [];
    const values: (string | null)[] = [];
    if ('title' in b) {
      sets.push('title = ?');
      values.push(checkTitle(b.title));
    }
    if ('client_id' in b) {
      sets.push('client_id = ?');
      values.push(checkClient(b.client_id, u.workspace_id));
    }
    if ('content_html' in b) {
      if (doc.kind !== 'page') throw new HttpError(400, 'Uploaded documents don’t have editable content.');
      if (typeof b.content_html !== 'string') throw new HttpError(400, 'Content must be text.');
      if (b.content_html.length > MAX_CONTENT_CHARS) throw new HttpError(413, 'This doc is too long to save.');
      sets.push('content_html = ?');
      values.push(b.content_html);
    }
    if (sets.length === 0) return res.json(docDetail(doc.id, u));

    db.prepare(`
      UPDATE docs SET ${sets.join(', ')}, version = version + 1, updated_by = ?, updated_at = datetime('now') WHERE id = ?
    `).run(...values, u.id, doc.id);
    res.json(docDetail(doc.id, u));
  });

  router.delete('/docs/:id', async (req, res) => {
    const u = user(res);
    const doc = findDoc(req.params.id, u.workspace_id);
    if (doc.created_by !== u.id && !isOwner(u.id, u.workspace_id)) {
      throw new HttpError(403, 'Only the doc’s creator and workspace owners can delete it.');
    }
    const keys = (db.prepare('SELECT storage_key FROM doc_files WHERE doc_id = ?').all(doc.id) as { storage_key: string }[])
      .map((f) => f.storage_key);
    db.prepare('DELETE FROM docs WHERE id = ?').run(doc.id);
    await removeUploads(keys);
    res.status(204).end();
  });

  // A file placed inside a page doc (the editor's "+ Upload document").
  router.post('/docs/:id/files', express.raw({ type: 'application/octet-stream', limit: MAX_DOC_FILE_BYTES }), async (req, res) => {
    const u = user(res);
    const doc = findDoc(req.params.id, u.workspace_id);
    if (doc.kind !== 'page') throw new HttpError(400, 'Files can only be added to written docs.');
    const file = await storeUpload(req);
    const r = db.prepare(`
      INSERT INTO doc_files (doc_id, role, uploaded_by, filename, mime_type, size, storage_key) VALUES (?, 'embed', ?, ?, ?, ?, ?)
    `).run(doc.id, u.id, file.filename, file.mime, file.size, file.key);
    res.status(201).json({ file: db.prepare(`SELECT ${FILE_COLUMNS} FROM doc_files WHERE id = ?`).get(r.lastInsertRowid) });
  });

  // ?inline=1 previews images, PDFs and plain text; everything else downloads.
  router.get('/doc-files/:id', (req, res) => {
    const file = db.prepare(`
      SELECT f.* FROM doc_files f JOIN docs d ON d.id = f.doc_id WHERE f.id = ? AND d.workspace_id = ?
    `).get(Number(req.params.id), user(res).workspace_id) as
      | { filename: string; mime_type: string; size: number; storage_key: string }
      | undefined;
    if (!file) throw new HttpError(404, 'File not found');
    sendUpload(res, file, req.query.inline === '1');
  });

  return router;
}
