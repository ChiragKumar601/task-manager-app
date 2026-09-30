import { Router, type Response } from 'express';
import type { Router as ExpressRouter } from 'express';
import { currentUser, type CurrentUser } from './auth.js';
import { CLOSED_STATUSES, db } from './db.js';
import { HttpError } from './http.js';

export const NOTIFICATION_KINDS = [
  'mention', 'assignment', 'status_change', 'due_reminder', 'change_request', 'request_decision',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// Each kind has a matching on/off column in notification_prefs (desktop pop-ups only —
// the inbox always gets everything).
export const PREF_COLUMNS: Record<NotificationKind, string> = {
  mention: 'mentions',
  assignment: 'assignments',
  status_change: 'status_changes',
  due_reminder: 'due_reminders',
  change_request: 'change_requests',
  request_decision: 'request_decisions',
};
const PREF_KEYS = Object.values(PREF_COLUMNS);

interface NotifyInput {
  userId: number;
  workspaceId: number;
  kind: NotificationKind;
  actorId?: number | null;
  taskId?: number | null;
  from?: string | null;
  to?: string | null;
  // Plain-text version, used for desktop pop-ups.
  message: string;
}

export function notify(n: NotifyInput) {
  db.prepare(`
    INSERT INTO notifications (user_id, workspace_id, kind, actor_id, task_id, from_value, to_value, message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(n.userId, n.workspaceId, n.kind, n.actorId ?? null, n.taskId ?? null, n.from ?? null, n.to ?? null, n.message);
}

// Reminds assignees about open tasks due today or tomorrow. The unique index on
// (user, task, due date) means each reminder is only ever created once.
export function createDueReminders() {
  const closed = CLOSED_STATUSES.map((s) => `'${s}'`).join(',');
  const rows = db.prepare(`
    SELECT t.id, t.title, t.workspace_id, t.due_date, a.user_id,
           t.due_date = date('now','localtime') AS due_today
      FROM tasks t JOIN task_assignees a ON a.task_id = t.id
     WHERE t.status NOT IN (${closed})
       AND t.due_date BETWEEN date('now','localtime') AND date('now','localtime','+1 day')
  `).all() as { id: number; title: string; workspace_id: number; due_date: string; user_id: number; due_today: number }[];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO notifications (user_id, workspace_id, kind, task_id, to_value, message)
    VALUES (?, ?, 'due_reminder', ?, ?, ?)
  `);
  let created = 0;
  for (const r of rows) {
    const when = r.due_today ? 'today' : 'tomorrow';
    created += Number(insert.run(r.user_id, r.workspace_id, r.id, r.due_date, `“${r.title}” is due ${when}`).changes);
  }
  return created;
}

const LIST_SELECT = `
  SELECT n.id, n.kind, n.from_value, n.to_value, n.message, n.read_at, n.created_at,
         n.actor_id, a.name AS actor_name, n.task_id, t.title AS task_title, t.due_date AS task_due_date
    FROM notifications n
    LEFT JOIN users a ON a.id = n.actor_id
    LEFT JOIN tasks t ON t.id = n.task_id
`;

function prefsFor(userId: number) {
  const row = db.prepare('SELECT * FROM notification_prefs WHERE user_id = ?').get(userId) as Record<string, number> | undefined;
  return Object.fromEntries(PREF_KEYS.map((k) => [k, row ? row[k] === 1 : true]));
}

const user = (res: Response) => res.locals.user as CurrentUser;

export function notificationsRouter(): ExpressRouter {
  const router = Router();

  router.use((req, res, next) => {
    const u = currentUser(req);
    if (!u) return res.status(404).json({ error: 'No users' });
    res.locals.user = u;
    next();
  });

  // ?filter=unread, ?before=<id> to page back, ?after=<id> for "anything new since".
  router.get('/notifications', (req, res) => {
    const u = user(res);
    const where = ['n.user_id = ?', 'n.workspace_id = ?'];
    const params: number[] = [u.id, u.workspace_id];
    if (req.query.filter === 'unread') where.push('n.read_at IS NULL');
    if (req.query.before) {
      where.push('n.id < ?');
      params.push(Number(req.query.before));
    }
    if (req.query.after) {
      where.push('n.id > ?');
      params.push(Number(req.query.after));
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const items = db.prepare(`${LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY n.id DESC LIMIT ?`).all(...params, limit + 1);
    const { unread } = db.prepare(`
      SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND workspace_id = ? AND read_at IS NULL
    `).get(u.id, u.workspace_id) as { unread: number };
    const { latest } = db.prepare('SELECT COALESCE(MAX(id), 0) AS latest FROM notifications WHERE user_id = ? AND workspace_id = ?')
      .get(u.id, u.workspace_id) as { latest: number };
    res.json({ items: items.slice(0, limit), hasMore: items.length > limit, unread, latestId: latest });
  });

  router.post('/notifications/:id/read', (req, res) => {
    const u = user(res);
    const read = req.body?.read !== false;
    const r = db.prepare(`
      UPDATE notifications SET read_at = ${read ? "COALESCE(read_at, datetime('now'))" : 'NULL'}
       WHERE id = ? AND user_id = ? AND workspace_id = ?
    `).run(Number(req.params.id), u.id, u.workspace_id);
    if (r.changes === 0) throw new HttpError(404, 'Notification not found');
    res.status(204).end();
  });

  router.post('/notifications/read-all', (_req, res) => {
    const u = user(res);
    const r = db.prepare(`
      UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND workspace_id = ? AND read_at IS NULL
    `).run(u.id, u.workspace_id);
    res.json({ marked: Number(r.changes) });
  });

  router.get('/notification-prefs', (_req, res) => {
    res.json({ prefs: prefsFor(user(res).id) });
  });

  // Partial update: send only the switches that changed.
  router.put('/notification-prefs', (req, res) => {
    const u = user(res);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const changes = PREF_KEYS.filter((k) => k in body);
    if (changes.length === 0) throw new HttpError(400, 'Nothing to change.');
    for (const k of changes) {
      if (typeof body[k] !== 'boolean') throw new HttpError(400, `${k} must be true or false.`);
    }
    db.prepare('INSERT OR IGNORE INTO notification_prefs (user_id) VALUES (?)').run(u.id);
    db.prepare(`UPDATE notification_prefs SET ${changes.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`)
      .run(...changes.map((k) => (body[k] ? 1 : 0)), u.id);
    res.json({ prefs: prefsFor(u.id) });
  });

  return router;
}
