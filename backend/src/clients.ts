import { Router, type Request } from 'express';
import type { Router as ExpressRouter } from 'express';
import { db, newPublicId, STATUSES } from './db.js';

// Keep in sync with CLIENT_COLORS in frontend/src/lib/clients.ts.
export const CLIENT_COLORS = [
  '#4f46e5', '#16a34a', '#ea7a0c', '#e11d48', '#a21caf',
  '#0891b2', '#db2777', '#22c55e', '#f04f12', '#7a1ef0',
];

export const newClientId = newPublicId;

interface ClientInput {
  name: string;
  email: string;
  phone: string;
  notes: string;
  color: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseClient(body: unknown): { value: ClientInput } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const value: ClientInput = {
    name: str(b.name),
    email: str(b.email),
    phone: str(b.phone),
    notes: typeof b.notes === 'string' ? b.notes : '',
    color: str(b.color),
  };
  if (!value.name) return { error: 'Name is required.' };
  if (value.name.length > 120) return { error: 'Name must be 120 characters or fewer.' };
  if (value.email && !EMAIL_RE.test(value.email)) return { error: 'Email doesn’t look valid.' };
  if (value.phone.length > 40) return { error: 'Phone must be 40 characters or fewer.' };
  if (!CLIENT_COLORS.includes(value.color)) return { error: 'Pick one of the listed colors.' };
  return { value };
}

type WorkspaceOf = (req: Request) => number | undefined;

export function clientsRouter(workspaceOf: WorkspaceOf): ExpressRouter {
  const router = Router();

  const findClient = (id: string, ws: number) =>
    db.prepare('SELECT * FROM clients WHERE id = ? AND workspace_id = ?').get(id, ws);

  router.use((req, res, next) => {
    const ws = workspaceOf(req);
    if (ws === undefined) return res.status(404).json({ error: 'No users' });
    res.locals.ws = ws;
    next();
  });

  router.get('/', (_req, res) => {
    const clients = db.prepare(`
      SELECT c.id, c.name, c.color,
             (SELECT COUNT(*) FROM tasks t WHERE t.client_id = c.id AND t.parent_id IS NULL) AS task_count,
             (SELECT COUNT(*) FROM docs  d WHERE d.client_id = c.id) AS doc_count
        FROM clients c
       WHERE c.workspace_id = ?
       ORDER BY c.created_at, c.name
    `).all(res.locals.ws);
    res.json({ clients });
  });

  router.post('/', (req, res) => {
    const parsed = parseClient(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const { name, email, phone, notes, color } = parsed.value;
    const id = newClientId();
    db.prepare(`
      INSERT INTO clients (id, workspace_id, name, email, phone, notes, color)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, res.locals.ws, name, email, phone, notes, color);
    res.status(201).json({ client: findClient(id, res.locals.ws) });
  });

  router.get('/:id', (req, res) => {
    const client = findClient(req.params.id, res.locals.ws);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const tasks = (db.prepare(`
      SELECT id, title, status, priority, due_date
        FROM tasks
       WHERE client_id = ? AND parent_id IS NULL
       ORDER BY due_date IS NULL, due_date, id
    `).all(req.params.id) as { status: string }[]).map((t) => ({
      ...t,
      status_label: STATUSES.find((s) => s.key === t.status)?.label ?? t.status,
    }));

    const docs = db.prepare(`
      SELECT id, title, created_at FROM docs WHERE client_id = ? ORDER BY created_at DESC
    `).all(req.params.id);

    res.json({ client, tasks, docs });
  });

  router.put('/:id', (req, res) => {
    if (!findClient(req.params.id, res.locals.ws)) {
      return res.status(404).json({ error: 'Client not found' });
    }
    const parsed = parseClient(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const { name, email, phone, notes, color } = parsed.value;
    db.prepare(`
      UPDATE clients
         SET name = ?, email = ?, phone = ?, notes = ?, color = ?, updated_at = datetime('now')
       WHERE id = ? AND workspace_id = ?
    `).run(name, email, phone, notes, color, req.params.id, res.locals.ws);
    res.json({ client: findClient(req.params.id, res.locals.ws) });
  });

  router.delete('/:id', (req, res) => {
    const r = db.prepare('DELETE FROM clients WHERE id = ? AND workspace_id = ?')
      .run(req.params.id, res.locals.ws);
    if (r.changes === 0) return res.status(404).json({ error: 'Client not found' });
    res.status(204).end();
  });

  return router;
}
