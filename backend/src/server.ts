import express from 'express';
import cors from 'cors';
import { db, STATUSES, CLOSED_STATUSES } from './db.js';
import { seed, seedClients, seedWorkspaceExtras } from './seed.js';
import { clientsRouter } from './clients.js';
import { workspacesRouter } from './workspaces.js';
import { tasksRouter } from './tasks.js';
import { docsRouter } from './docs.js';
import { errorHandler } from './http.js';
import { createDueReminders, notificationsRouter } from './notifications.js';
import { currentUser } from './auth.js';

const PORT = Number(process.env.PORT ?? 4000);

// Seed on first run so the dashboard has something to show.
const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
if (n === 0) seed();
else {
  // Databases created before the clients feature get the demo clients once.
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM clients').get() as { c: number };
  if (c === 0) seedClients();
  // ...and the demo members and label once, before the settings page existed.
  const { l } = db.prepare('SELECT COUNT(*) AS l FROM labels').get() as { l: number };
  if (l === 0) seedWorkspaceExtras();
}

const closedList = CLOSED_STATUSES.map((s) => `'${s}'`).join(',');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/dashboard', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(404).json({ error: 'No users' });
  const ws = user.workspace_id;

  const count = (sql: string, ...params: (number | string)[]) =>
    (db.prepare(sql).get(...params) as { n: number }).n;

  const myOpen = `workspace_id = ? AND status NOT IN (${closedList})
    AND EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = tasks.id AND a.user_id = ?)`;

  const stats = {
    myOpenTasks: count(`SELECT COUNT(*) AS n FROM tasks WHERE ${myOpen}`, ws, user.id),
    overdue: count(
      `SELECT COUNT(*) AS n FROM tasks WHERE ${myOpen} AND due_date < date('now','localtime')`,
      ws, user.id,
    ),
    dueThisWeek: count(
      `SELECT COUNT(*) AS n FROM tasks WHERE ${myOpen}
         AND due_date BETWEEN date('now','localtime') AND date('now','localtime','+7 days')`,
      ws, user.id,
    ),
    awaitingReview: count(
      `SELECT COUNT(*) AS n FROM change_requests cr JOIN tasks t ON t.id = cr.task_id
        WHERE t.workspace_id = ? AND t.created_by = ? AND cr.status = 'pending'`,
      ws, user.id,
    ),
    unreadInbox: count(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND workspace_id = ? AND read_at IS NULL',
      user.id, ws,
    ),
  };

  const dueSoon = db.prepare(`
    SELECT id, title, status, priority, due_date,
           due_date < date('now','localtime') AS is_overdue
      FROM tasks
     WHERE ${myOpen}
       AND due_date IS NOT NULL
       AND due_date <= date('now','localtime','+7 days')
     ORDER BY due_date
     LIMIT 10
  `).all(ws, user.id);

  const reviews = db.prepare(`
    SELECT cr.id, cr.note, cr.created_at, t.id AS task_id, t.title AS task_title, u.name AS requested_by
      FROM change_requests cr
      JOIN tasks t ON t.id = cr.task_id
      JOIN users u ON u.id = cr.requested_by
     WHERE t.workspace_id = ? AND t.created_by = ? AND cr.status = 'pending'
     ORDER BY cr.created_at DESC
     LIMIT 10
  `).all(ws, user.id);

  // Sub-tasks are rolled up into their parent, so only top-level tasks are counted.
  const statusRows = db.prepare(`
    SELECT status, COUNT(*) AS n FROM tasks
     WHERE workspace_id = ? AND parent_id IS NULL
     GROUP BY status
  `).all(ws) as { status: string; n: number }[];
  const byStatus = STATUSES.map(({ key, label }) => ({
    key,
    label,
    count: statusRows.find((r) => r.status === key)?.n ?? 0,
  }));

  const byPerson = db.prepare(`
    SELECT u.id, u.name, COUNT(*) AS count
      FROM tasks t
      JOIN task_assignees a ON a.task_id = t.id
      JOIN users u ON u.id = a.user_id
     WHERE t.workspace_id = ? AND t.parent_id IS NULL AND t.status NOT IN (${closedList})
     GROUP BY u.id
     ORDER BY count DESC, u.name
  `).all(ws);
  const unassignedOpen = count(
    `SELECT COUNT(*) AS n FROM tasks
      WHERE workspace_id = ? AND parent_id IS NULL AND status NOT IN (${closedList})
        AND NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = tasks.id)`,
    ws,
  );

  res.json({ stats, dueSoon, reviews, byStatus, byPerson, unassignedOpen });
});

app.use('/api', workspacesRouter());
app.use('/api/clients', clientsRouter((req) => currentUser(req)?.workspace_id));
app.use('/api', tasksRouter());
app.use('/api', docsRouter());
app.use('/api', notificationsRouter());
app.use(errorHandler);

// Due-date reminders: once at startup, then every 15 minutes (duplicates are ignored).
createDueReminders();
setInterval(createDueReminders, 15 * 60_000).unref();

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
