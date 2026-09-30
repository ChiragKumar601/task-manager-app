import { Router, type Response } from 'express';
import type { Router as ExpressRouter } from 'express';
import { currentUser, type CurrentUser } from './auth.js';
import { db, newInviteCode } from './db.js';

// Keep in sync with LABEL_COLORS in frontend/src/lib/labels.ts.
export const LABEL_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
];

function workspacesOf(userId: number) {
  return db.prepare(`
    SELECT w.id, w.name, m.role
      FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.user_id = ?
     ORDER BY m.joined_at, w.id
  `).all(userId);
}

function meResponse(user: CurrentUser) {
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as unknown as CurrentUser;
  const workspace = db.prepare('SELECT id, name FROM workspaces WHERE id = ?').get(fresh.workspace_id);
  return { user: fresh, workspace, workspaces: workspacesOf(fresh.id) };
}

function switchTo(userId: number, workspaceId: number) {
  db.prepare('UPDATE users SET workspace_id = ? WHERE id = ?').run(workspaceId, userId);
}

function user(res: Response) {
  return res.locals.user as CurrentUser;
}

export function workspacesRouter(): ExpressRouter {
  const router = Router();

  router.use((req, res, next) => {
    const u = currentUser(req);
    if (!u) return res.status(404).json({ error: 'No users' });
    res.locals.user = u;
    next();
  });

  router.get('/me', (_req, res) => {
    res.json(meResponse(user(res)));
  });

  router.put('/me/workspace', (req, res) => {
    const workspaceId = Number((req.body ?? {}).workspaceId);
    const member = db.prepare('SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?')
      .get(workspaceId, user(res).id);
    if (!member) return res.status(403).json({ error: 'You’re not a member of that workspace.' });
    switchTo(user(res).id, workspaceId);
    res.json(meResponse(user(res)));
  });

  router.post('/workspaces', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'Workspace name is required.' });
    if (name.length > 80) return res.status(400).json({ error: 'Workspace name must be 80 characters or fewer.' });

    const u = user(res);
    db.exec('BEGIN');
    try {
      const r = db.prepare('INSERT INTO workspaces (name, invite_code) VALUES (?, ?)').run(name, newInviteCode());
      const workspaceId = Number(r.lastInsertRowid);
      db.prepare("INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(workspaceId, u.id);
      switchTo(u.id, workspaceId);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.status(201).json(meResponse(u));
  });

  router.post('/workspaces/join', (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    if (!code) return res.status(400).json({ error: 'Enter an invite code.' });

    const workspace = db.prepare('SELECT id FROM workspaces WHERE invite_code = ?').get(code) as
      | { id: number }
      | undefined;
    if (!workspace) return res.status(404).json({ error: 'That invite code doesn’t match any workspace.' });

    const u = user(res);
    const r = db.prepare('INSERT OR IGNORE INTO memberships (workspace_id, user_id) VALUES (?, ?)')
      .run(workspace.id, u.id);
    if (r.changes === 0) return res.status(409).json({ error: 'You’re already a member of that workspace.' });
    switchTo(u.id, workspace.id);
    res.status(201).json(meResponse(u));
  });

  // Everything the settings page needs about the open workspace, apart from clients.
  router.get('/workspace', (_req, res) => {
    const ws = user(res).workspace_id;
    const workspace = db.prepare('SELECT id, name, invite_code FROM workspaces WHERE id = ?').get(ws);
    const members = db.prepare(`
      SELECT u.id, u.name, u.email, m.role
        FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ?
       ORDER BY m.role = 'owner' DESC, m.joined_at, u.id
    `).all(ws);
    res.json({ workspace, members });
  });

  router.get('/labels', (_req, res) => {
    const labels = db.prepare('SELECT id, name, color FROM labels WHERE workspace_id = ? ORDER BY created_at, id')
      .all(user(res).workspace_id);
    res.json({ labels });
  });

  router.post('/labels', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const color = typeof req.body?.color === 'string' ? req.body.color : '';
    if (!name) return res.status(400).json({ error: 'Label name is required.' });
    if (name.length > 40) return res.status(400).json({ error: 'Label name must be 40 characters or fewer.' });
    if (!LABEL_COLORS.includes(color)) return res.status(400).json({ error: 'Pick one of the listed colors.' });

    const ws = user(res).workspace_id;
    const taken = db.prepare('SELECT 1 FROM labels WHERE workspace_id = ? AND name = ? COLLATE NOCASE').get(ws, name);
    if (taken) return res.status(409).json({ error: `There’s already a label called “${name}”.` });

    const r = db.prepare('INSERT INTO labels (workspace_id, name, color) VALUES (?, ?, ?)').run(ws, name, color);
    const label = db.prepare('SELECT id, name, color FROM labels WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json({ label });
  });

  router.delete('/labels/:id', (req, res) => {
    const r = db.prepare('DELETE FROM labels WHERE id = ? AND workspace_id = ?')
      .run(Number(req.params.id), user(res).workspace_id);
    if (r.changes === 0) return res.status(404).json({ error: 'Label not found' });
    res.status(204).end();
  });

  return router;
}
