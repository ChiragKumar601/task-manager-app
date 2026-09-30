import express, { Router, type Response } from 'express';
import type { Router as ExpressRouter } from 'express';
import { currentUser, type CurrentUser } from './auth.js';
import { db, PRIORITIES, STATUSES, transaction } from './db.js';
import { HttpError, removeUploads, sendUpload, storeUpload } from './http.js';
import { notify } from './notifications.js';

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const STATUS_KEYS: string[] = STATUSES.map((s) => s.key);
const PRIORITY_KEYS: string[] = PRIORITIES.map((p) => p.key);
const statusLabel = (key: string) => STATUSES.find((s) => s.key === key)?.label ?? key;

interface TaskRow {
  id: number;
  workspace_id: number;
  parent_id: number | null;
  client_id: string | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  start_date: string;
  end_date: string;
  due_date: string | null;
  created_by: number;
}

const user = (res: Response) => res.locals.user as CurrentUser;

function findTask(id: number, ws: number): TaskRow {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(id, ws) as unknown as
    | TaskRow
    | undefined;
  if (!task) throw new HttpError(404, 'Task not found');
  return task;
}

function isOwner(userId: number, ws: number) {
  return !!db.prepare("SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ? AND role = 'owner'").get(ws, userId);
}

function isAssignee(taskId: number, userId: number) {
  return !!db.prepare('SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?').get(taskId, userId);
}

// The creator, anyone assigned, and workspace owners can change a task. Everyone can comment.
function canEdit(task: TaskRow, u: CurrentUser) {
  return task.created_by === u.id || isAssignee(task.id, u.id) || isOwner(u.id, task.workspace_id);
}

function requireEdit(task: TaskRow, u: CurrentUser) {
  if (!canEdit(task, u)) {
    throw new HttpError(403, 'Only the task’s creator, assignees and workspace owners can change it.');
  }
}

// ---------- Input parsing ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: unknown, field: string, { optional = false } = {}): string | null {
  if (optional && (value === null || value === '')) return null;
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new HttpError(400, `${field} must be a date (YYYY-MM-DD).`);
  }
  return value;
}

function parseIdList(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || !value.every((v) => Number.isInteger(v))) {
    throw new HttpError(400, `${field} must be a list of ids.`);
  }
  return [...new Set(value as number[])];
}

interface TaskInput {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  client_id?: string | null;
  start_date?: string;
  end_date?: string;
  due_date?: string | null;
  assignee_ids?: number[];
  label_ids?: number[];
}

// Validates whichever fields are present; `ws` is used to check ids belong to the workspace.
function parseTaskInput(body: unknown, ws: number): TaskInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const input: TaskInput = {};

  if ('title' in b) {
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title) throw new HttpError(400, 'Title is required.');
    if (title.length > 200) throw new HttpError(400, 'Title must be 200 characters or fewer.');
    input.title = title;
  }
  if ('description' in b) {
    if (typeof b.description !== 'string') throw new HttpError(400, 'Description must be text.');
    if (b.description.length > 20_000) throw new HttpError(400, 'Description is too long.');
    input.description = b.description;
  }
  if ('status' in b) {
    if (typeof b.status !== 'string' || !STATUS_KEYS.includes(b.status)) throw new HttpError(400, 'Unknown status.');
    input.status = b.status;
  }
  if ('priority' in b) {
    if (typeof b.priority !== 'string' || !PRIORITY_KEYS.includes(b.priority)) throw new HttpError(400, 'Unknown priority.');
    input.priority = b.priority;
  }
  if ('client_id' in b) {
    if (b.client_id === null || b.client_id === '') input.client_id = null;
    else if (typeof b.client_id === 'string'
      && db.prepare('SELECT 1 FROM clients WHERE id = ? AND workspace_id = ?').get(b.client_id, ws)) {
      input.client_id = b.client_id;
    } else throw new HttpError(400, 'That client isn’t in this workspace.');
  }
  if ('start_date' in b) input.start_date = parseDate(b.start_date, 'Start date')!;
  if ('end_date' in b) input.end_date = parseDate(b.end_date, 'End date')!;
  if ('due_date' in b) input.due_date = parseDate(b.due_date, 'Due date', { optional: true });

  if ('assignee_ids' in b) {
    const ids = parseIdList(b.assignee_ids, 'Assignees');
    const members = new Set((db.prepare('SELECT user_id FROM memberships WHERE workspace_id = ?').all(ws) as { user_id: number }[])
      .map((m) => m.user_id));
    if (!ids.every((id) => members.has(id))) throw new HttpError(400, 'Assignees must be members of this workspace.');
    input.assignee_ids = ids;
  }
  if ('label_ids' in b) {
    const ids = parseIdList(b.label_ids, 'Labels');
    const labels = new Set((db.prepare('SELECT id FROM labels WHERE workspace_id = ?').all(ws) as { id: number }[])
      .map((l) => l.id));
    if (!ids.every((id) => labels.has(id))) throw new HttpError(400, 'Labels must belong to this workspace.');
    input.label_ids = ids;
  }
  return input;
}

// ---------- Writes shared by create and update ----------

const nameOf = (userId: number) =>
  (db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string } | undefined)?.name ?? 'Someone';

function logEvent(taskId: number, actorId: number, kind: string, from: string | null, to: string | null) {
  db.prepare('INSERT INTO task_events (task_id, actor_id, kind, from_value, to_value) VALUES (?, ?, ?, ?, ?)')
    .run(taskId, actorId, kind, from, to);
}

const nextPosition = (ws: number, status: string) =>
  (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM tasks WHERE workspace_id = ? AND status = ?')
    .get(ws, status) as { p: number }).p;

// `quiet` skips the "assigned you" notification for that user (they get a better one elsewhere).
function setAssignees(task: TaskRow, ids: number[], actor: CurrentUser, { log, quiet }: { log: boolean; quiet?: number }) {
  const current = new Set((db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(task.id) as { user_id: number }[])
    .map((a) => a.user_id));
  const next = new Set(ids);
  for (const id of next) {
    if (current.has(id)) continue;
    db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(task.id, id);
    if (log) logEvent(task.id, actor.id, 'assignee_added', null, nameOf(id));
    if (id !== actor.id && id !== quiet) {
      notify({
        userId: id, workspaceId: task.workspace_id, kind: 'assignment', actorId: actor.id, taskId: task.id,
        message: `${actor.name} assigned you to “${task.title}”`,
      });
    }
  }
  for (const id of current) {
    if (next.has(id)) continue;
    db.prepare('DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?').run(task.id, id);
    if (log) logEvent(task.id, actor.id, 'assignee_removed', nameOf(id), null);
  }
}

function setLabels(task: TaskRow, ids: number[], actor: CurrentUser, { log }: { log: boolean }) {
  const current = new Set((db.prepare('SELECT label_id FROM task_labels WHERE task_id = ?').all(task.id) as { label_id: number }[])
    .map((l) => l.label_id));
  const next = new Set(ids);
  const labelName = (id: number) => (db.prepare('SELECT name FROM labels WHERE id = ?').get(id) as { name: string }).name;
  for (const id of next) {
    if (current.has(id)) continue;
    db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').run(task.id, id);
    if (log) logEvent(task.id, actor.id, 'label_added', null, labelName(id));
  }
  for (const id of current) {
    if (next.has(id)) continue;
    if (log) logEvent(task.id, actor.id, 'label_removed', labelName(id), null);
    db.prepare('DELETE FROM task_labels WHERE task_id = ? AND label_id = ?').run(task.id, id);
  }
}

// ---------- Reads ----------

const CARD_SELECT = `
  SELECT t.id, t.parent_id, p.title AS parent_title, t.title, t.description, t.status, t.priority,
         t.start_date, t.end_date, t.due_date, t.client_id, t.position,
         t.created_by, u.name AS creator_name, t.created_at,
         (SELECT json_group_array(user_id) FROM
            (SELECT user_id FROM task_assignees WHERE task_id = t.id ORDER BY assigned_at, user_id)) AS assignee_ids,
         (SELECT json_group_array(label_id) FROM task_labels WHERE task_id = t.id) AS label_ids,
         (SELECT COUNT(*) FROM comments WHERE task_id = t.id) AS comment_count,
         (SELECT COUNT(*) FROM checklist_items WHERE task_id = t.id) AS checklist_total,
         (SELECT COUNT(*) FROM checklist_items WHERE task_id = t.id AND done = 1) AS checklist_done
    FROM tasks t
    JOIN users u ON u.id = t.created_by
    LEFT JOIN tasks p ON p.id = t.parent_id
`;

function toCard(row: Record<string, unknown>) {
  return {
    ...row,
    assignee_ids: JSON.parse(row.assignee_ids as string) as number[],
    label_ids: JSON.parse(row.label_ids as string) as number[],
  };
}

function cardById(id: number) {
  return toCard(db.prepare(`${CARD_SELECT} WHERE t.id = ?`).get(id) as Record<string, unknown>);
}

function taskDetail(task: TaskRow, u: CurrentUser) {
  const card = cardById(task.id);
  const subtasks = db.prepare(`${CARD_SELECT} WHERE t.parent_id = ? ORDER BY t.created_at, t.id`).all(task.id).map(toCard);
  const checklist = db.prepare('SELECT id, text, done FROM checklist_items WHERE task_id = ? ORDER BY position, id').all(task.id);
  const comments = db.prepare(`
    SELECT c.id, c.body, c.created_at, c.author_id, u.name AS author_name
      FROM comments c JOIN users u ON u.id = c.author_id
     WHERE c.task_id = ? ORDER BY c.created_at, c.id
  `).all(task.id);
  const attachments = db.prepare(`
    SELECT id, filename, mime_type, size, created_at FROM attachments WHERE task_id = ? ORDER BY created_at, id
  `).all(task.id);
  const requests = db.prepare(`
    SELECT cr.id, cr.requested_by, u.name AS requester_name, cr.created_at
      FROM change_requests cr JOIN users u ON u.id = cr.requested_by
     WHERE cr.task_id = ? AND cr.status = 'pending'
     ORDER BY cr.created_at
  `).all(task.id) as { requested_by: number }[];

  return {
    task: card,
    subtasks,
    checklist: checklist.map((c) => ({ ...c, done: c.done === 1 })),
    comments,
    attachments,
    requests,
    permissions: {
      canEdit: canEdit(task, u),
      canEditDescription: task.created_by === u.id,
      canDelete: task.created_by === u.id || isOwner(u.id, task.workspace_id),
      hasPendingRequest: requests.some((r) => r.requested_by === u.id),
    },
  };
}

// Mentions are "@First" or "@First Last", matched against workspace members.
function mentionedMembers(body: string, ws: number) {
  const members = db.prepare(`
    SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?
  `).all(ws) as { id: number; name: string }[];
  const lower = body.toLowerCase();
  return members.filter((m) => {
    const first = m.name.split(/\s+/)[0] ?? m.name;
    return [m.name, first].some((n) => new RegExp(`(^|\\s)@${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower));
  });
}

// ---------- Router ----------

export function tasksRouter(): ExpressRouter {
  const router = Router();

  router.use((req, res, next) => {
    const u = currentUser(req);
    if (!u) return res.status(404).json({ error: 'No users' });
    res.locals.user = u;
    next();
  });

  // Everything the board needs in one go: cards plus the people, labels and clients to filter by.
  router.get('/tasks', (_req, res) => {
    const ws = user(res).workspace_id;
    const tasks = db.prepare(`${CARD_SELECT} WHERE t.workspace_id = ? ORDER BY t.position, t.id`).all(ws).map(toCard);
    const members = db.prepare(`
      SELECT u.id, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? ORDER BY m.role = 'owner' DESC, m.joined_at, u.id
    `).all(ws);
    const labels = db.prepare('SELECT id, name, color FROM labels WHERE workspace_id = ? ORDER BY created_at, id').all(ws);
    const clients = db.prepare('SELECT id, name, color FROM clients WHERE workspace_id = ? ORDER BY created_at, name').all(ws);
    res.json({ tasks, members, labels, clients });
  });

  router.post('/tasks', (req, res) => {
    const u = user(res);
    const ws = u.workspace_id;
    const input = parseTaskInput(req.body, ws);
    if (input.title === undefined) throw new HttpError(400, 'Title is required.');
    if (!input.start_date || !input.end_date) throw new HttpError(400, 'Start and end dates are required.');
    if (input.end_date < input.start_date) throw new HttpError(400, 'End date can’t be before the start date.');

    let parentId: number | null = null;
    const rawParent = (req.body as Record<string, unknown>).parent_id;
    if (rawParent !== undefined && rawParent !== null) {
      const parent = findTask(Number(rawParent), ws);
      if (parent.parent_id !== null) throw new HttpError(400, 'Subtasks can’t have their own subtasks.');
      requireEdit(parent, u);
      parentId = parent.id;
    }

    const status = input.status ?? 'todo';
    const id = transaction(() => {
      const r = db.prepare(`
        INSERT INTO tasks (workspace_id, parent_id, client_id, title, description, status, priority,
                           start_date, end_date, due_date, position, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(ws, parentId, input.client_id ?? null, input.title!, input.description ?? '', status,
        input.priority ?? 'none', input.start_date!, input.end_date!, input.due_date ?? null, nextPosition(ws, status), u.id);
      const taskId = Number(r.lastInsertRowid);
      logEvent(taskId, u.id, 'created', null, status);
      const task = findTask(taskId, ws);
      if (input.assignee_ids) setAssignees(task, input.assignee_ids, u, { log: false });
      if (input.label_ids) setLabels(task, input.label_ids, u, { log: false });
      return taskId;
    });
    res.status(201).json({ task: cardById(id) });
  });

  router.get('/tasks/:id', (req, res) => {
    const task = findTask(Number(req.params.id), user(res).workspace_id);
    res.json(taskDetail(task, user(res)));
  });

  // Partial update: only the fields sent are changed, and each change is logged to history.
  router.patch('/tasks/:id', (req, res) => {
    const u = user(res);
    const task = findTask(Number(req.params.id), u.workspace_id);
    requireEdit(task, u);
    const input = parseTaskInput(req.body, u.workspace_id);
    // Assignees and owners can change most things, but the description belongs to whoever wrote the task.
    if (input.description !== undefined && input.description !== task.description && task.created_by !== u.id) {
      throw new HttpError(403, 'Only the task’s creator can edit its description.');
    }

    const start = input.start_date ?? task.start_date;
    const end = input.end_date ?? task.end_date;
    if (end < start) throw new HttpError(400, 'End date can’t be before the start date.');

    transaction(() => {
      const simple = ['title', 'description', 'priority', 'start_date', 'end_date', 'due_date'] as const;
      for (const field of simple) {
        const value = input[field];
        if (value === undefined || value === task[field]) continue;
        db.prepare(`UPDATE tasks SET ${field} = ? WHERE id = ?`).run(value, task.id);
        // Descriptions can be long; history just notes that it changed.
        if (field === 'description') logEvent(task.id, u.id, 'description', null, null);
        else logEvent(task.id, u.id, field, task[field], value);
      }

      if (input.client_id !== undefined && input.client_id !== task.client_id) {
        const clientName = (id: string | null) =>
          id ? (db.prepare('SELECT name FROM clients WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? null : null;
        db.prepare('UPDATE tasks SET client_id = ? WHERE id = ?').run(input.client_id, task.id);
        logEvent(task.id, u.id, 'client', clientName(task.client_id), clientName(input.client_id));
      }

      if (input.status !== undefined && input.status !== task.status) {
        db.prepare('UPDATE tasks SET status = ?, position = ? WHERE id = ?')
          .run(input.status, nextPosition(u.workspace_id, input.status), task.id);
        logEvent(task.id, u.id, 'status', task.status, input.status);
        // Everyone the task belongs to hears about the move: its creator and its assignees.
        const assignees = (db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(task.id) as { user_id: number }[])
          .map((a) => a.user_id);
        for (const recipient of new Set([task.created_by, ...assignees])) {
          if (recipient === u.id) continue;
          notify({
            userId: recipient, workspaceId: task.workspace_id, kind: 'status_change', actorId: u.id, taskId: task.id,
            from: task.status, to: input.status,
            message: `${u.name} moved “${task.title}” from ${statusLabel(task.status)} to ${statusLabel(input.status)}`,
          });
        }
      }

      if (input.assignee_ids) setAssignees(task, input.assignee_ids, u, { log: true });
      if (input.label_ids) setLabels(task, input.label_ids, u, { log: true });
      db.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").run(task.id);
    });

    res.json(taskDetail(findTask(task.id, u.workspace_id), u));
  });

  router.delete('/tasks/:id', async (req, res) => {
    const u = user(res);
    const task = findTask(Number(req.params.id), u.workspace_id);
    if (task.created_by !== u.id && !isOwner(u.id, u.workspace_id)) {
      throw new HttpError(403, 'Only the task’s creator and workspace owners can delete it.');
    }
    // Collect files for this task and its subtasks before the rows cascade away.
    const files = db.prepare(`
      SELECT storage_key FROM attachments WHERE task_id IN (SELECT id FROM tasks WHERE id = ? OR parent_id = ?)
    `).all(task.id, task.id) as { storage_key: string }[];
    db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
    await removeUploads(files.map((f) => f.storage_key));
    res.status(204).end();
  });

  router.get('/tasks/:id/history', (req, res) => {
    const task = findTask(Number(req.params.id), user(res).workspace_id);
    const events = db.prepare(`
      SELECT e.id, e.kind, e.from_value, e.to_value, e.created_at, e.actor_id, u.name AS actor_name
        FROM task_events e JOIN users u ON u.id = e.actor_id
       WHERE e.task_id = ?
       ORDER BY e.created_at, e.id
    `).all(task.id);
    res.json({ events });
  });

  // ----- Checklist -----

  const findChecklistItem = (itemId: number, ws: number) => {
    const row = db.prepare(`
      SELECT ci.id, ci.task_id FROM checklist_items ci JOIN tasks t ON t.id = ci.task_id
       WHERE ci.id = ? AND t.workspace_id = ?
    `).get(itemId, ws) as { id: number; task_id: number } | undefined;
    if (!row) throw new HttpError(404, 'Checklist item not found');
    return { item: row, task: findTask(row.task_id, ws) };
  };

  router.post('/tasks/:id/checklist', (req, res) => {
    const u = user(res);
    const task = findTask(Number(req.params.id), u.workspace_id);
    requireEdit(task, u);
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) throw new HttpError(400, 'Checklist item can’t be empty.');
    if (text.length > 500) throw new HttpError(400, 'Checklist item must be 500 characters or fewer.');
    db.prepare(`
      INSERT INTO checklist_items (task_id, text, position)
      VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM checklist_items WHERE task_id = ?))
    `).run(task.id, text, task.id);
    res.status(201).json(taskDetail(task, u));
  });

  router.patch('/checklist/:itemId', (req, res) => {
    const u = user(res);
    const { item, task } = findChecklistItem(Number(req.params.itemId), u.workspace_id);
    requireEdit(task, u);
    if (typeof req.body?.done !== 'boolean') throw new HttpError(400, '`done` must be true or false.');
    db.prepare('UPDATE checklist_items SET done = ? WHERE id = ?').run(req.body.done ? 1 : 0, item.id);
    res.json(taskDetail(task, u));
  });

  router.delete('/checklist/:itemId', (req, res) => {
    const u = user(res);
    const { item, task } = findChecklistItem(Number(req.params.itemId), u.workspace_id);
    requireEdit(task, u);
    db.prepare('DELETE FROM checklist_items WHERE id = ?').run(item.id);
    res.json(taskDetail(task, u));
  });

  // ----- Comments (any member can comment) -----

  router.post('/tasks/:id/comments', (req, res) => {
    const u = user(res);
    const task = findTask(Number(req.params.id), u.workspace_id);
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) throw new HttpError(400, 'Comment can’t be empty.');
    if (body.length > 5000) throw new HttpError(400, 'Comment must be 5000 characters or fewer.');
    transaction(() => {
      db.prepare('INSERT INTO comments (task_id, author_id, body) VALUES (?, ?, ?)').run(task.id, u.id, body);
      for (const m of mentionedMembers(body, u.workspace_id)) {
        if (m.id !== u.id) {
          notify({
            userId: m.id, workspaceId: task.workspace_id, kind: 'mention', actorId: u.id, taskId: task.id,
            message: `${u.name} mentioned you on “${task.title}”`,
          });
        }
      }
    });
    res.status(201).json(taskDetail(task, u));
  });

  // ----- Attachments -----

  router.post('/tasks/:id/attachments',
    express.raw({ type: 'application/octet-stream', limit: MAX_ATTACHMENT_BYTES }),
    async (req, res) => {
      const u = user(res);
      const task = findTask(Number(req.params.id), u.workspace_id);
      requireEdit(task, u);
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE task_id = ?').get(task.id) as { n: number };
      if (n >= MAX_ATTACHMENTS) throw new HttpError(400, `A task can have at most ${MAX_ATTACHMENTS} attachments.`);

      const file = await storeUpload(req);
      db.prepare(`
        INSERT INTO attachments (task_id, uploaded_by, filename, mime_type, size, storage_key) VALUES (?, ?, ?, ?, ?, ?)
      `).run(task.id, u.id, file.filename, file.mime, file.size, file.key);
      res.status(201).json(taskDetail(task, u));
    });

  const findAttachment = (id: number, ws: number) => {
    const row = db.prepare(`
      SELECT a.* FROM attachments a JOIN tasks t ON t.id = a.task_id WHERE a.id = ? AND t.workspace_id = ?
    `).get(id, ws) as { id: number; task_id: number; filename: string; mime_type: string; size: number; storage_key: string } | undefined;
    if (!row) throw new HttpError(404, 'Attachment not found');
    return row;
  };

  // Always a download so uploaded HTML/SVG can't run on our origin.
  router.get('/attachments/:id', (req, res) => {
    sendUpload(res, findAttachment(Number(req.params.id), user(res).workspace_id));
  });

  router.delete('/attachments/:id', async (req, res) => {
    const u = user(res);
    const a = findAttachment(Number(req.params.id), u.workspace_id);
    const task = findTask(a.task_id, u.workspace_id);
    requireEdit(task, u);
    db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
    await removeUploads([a.storage_key]);
    res.json(taskDetail(task, u));
  });

  // ----- Quick Capture -----
  // Creates many To do tasks at once, all or nothing. "personal" assigns them to the creator;
  // "meeting" leaves them unassigned and notes where they came from.

  router.post('/tasks/bulk', (req, res) => {
    const u = user(res);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const source = b.source;
    if (source !== 'meeting' && source !== 'personal') throw new HttpError(400, 'Source must be "meeting" or "personal".');
    const date = parseDate(b.date, 'Date')!;
    if (!Array.isArray(b.titles) || b.titles.length === 0) throw new HttpError(400, 'Add at least one task.');
    if (b.titles.length > 100) throw new HttpError(400, 'You can create up to 100 tasks at a time.');
    const titles = b.titles.map((t) => (typeof t === 'string' ? t.trim() : ''));
    const bad = titles.findIndex((t) => !t || t.length > 200);
    if (bad !== -1) throw new HttpError(400, `Task ${bad + 1} needs a title of 1–200 characters.`);

    const description = source === 'meeting' ? `Captured from meeting notes on ${date}.` : '';
    const ids = transaction(() => titles.map((title) => {
      const r = db.prepare(`
        INSERT INTO tasks (workspace_id, title, description, status, priority, start_date, end_date, position, created_by)
        VALUES (?, ?, ?, 'todo', 'none', ?, ?, ?, ?)
      `).run(u.workspace_id, title, description, date, date, nextPosition(u.workspace_id, 'todo'), u.id);
      const id = Number(r.lastInsertRowid);
      logEvent(id, u.id, 'created', null, 'todo');
      if (source === 'personal') db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(id, u.id);
      return id;
    }));
    res.status(201).json({ tasks: ids.map(cardById) });
  });

  // ----- "Ask to be assigned" -----

  router.post('/tasks/:id/assign-requests', (req, res) => {
    const u = user(res);
    const task = findTask(Number(req.params.id), u.workspace_id);
    if (isAssignee(task.id, u.id)) throw new HttpError(409, 'You’re already assigned to this task.');
    const pending = db.prepare("SELECT 1 FROM change_requests WHERE task_id = ? AND requested_by = ? AND status = 'pending'")
      .get(task.id, u.id);
    if (pending) throw new HttpError(409, 'You’ve already asked to be assigned.');
    transaction(() => {
      db.prepare('INSERT INTO change_requests (task_id, requested_by, note) VALUES (?, ?, ?)')
        .run(task.id, u.id, 'Asked to be assigned');
      if (task.created_by !== u.id) {
        notify({
          userId: task.created_by, workspaceId: task.workspace_id, kind: 'change_request', actorId: u.id, taskId: task.id,
          message: `${u.name} asked to be assigned to “${task.title}”`,
        });
      }
    });
    res.status(201).json(taskDetail(task, u));
  });

  router.put('/change-requests/:id', (req, res) => {
    const u = user(res);
    const cr = db.prepare(`
      SELECT cr.id, cr.task_id, cr.requested_by, cr.status FROM change_requests cr JOIN tasks t ON t.id = cr.task_id
       WHERE cr.id = ? AND t.workspace_id = ?
    `).get(Number(req.params.id), u.workspace_id) as { id: number; task_id: number; requested_by: number; status: string } | undefined;
    if (!cr) throw new HttpError(404, 'Request not found');
    if (cr.status !== 'pending') throw new HttpError(409, 'That request has already been handled.');
    const task = findTask(cr.task_id, u.workspace_id);
    requireEdit(task, u);

    const decision = req.body?.status;
    if (decision !== 'approved' && decision !== 'rejected') throw new HttpError(400, 'Status must be approved or rejected.');

    transaction(() => {
      db.prepare("UPDATE change_requests SET status = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?")
        .run(decision, u.id, cr.id);
      if (decision === 'approved') {
        const current = (db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(task.id) as { user_id: number }[])
          .map((a) => a.user_id);
        setAssignees(task, [...current, cr.requested_by], u, { log: true, quiet: cr.requested_by });
      }
      notify({
        userId: cr.requested_by, workspaceId: task.workspace_id, kind: 'request_decision', actorId: u.id, taskId: task.id,
        to: decision,
        message: `${u.name} ${decision === 'approved' ? 'approved' : 'declined'} your request to be assigned to “${task.title}”`,
      });
    });
    res.json(taskDetail(task, u));
  });

  return router;
}
