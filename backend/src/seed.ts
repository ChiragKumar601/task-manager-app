import { db, newInviteCode, newPublicId, transaction } from './db.js';
import { newClientId } from './clients.js';

// SQLite datetime('now') format (UTC), `minutesAgo` before now.
const ago = (minutesAgo: number) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString().replace('T', ' ').slice(0, 19);

// A calendar date `offset` days from today, as YYYY-MM-DD.
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

interface SeedTask {
  title: string;
  status: string;
  priority?: string;
  parent?: number;
  due?: number;
  createdBy?: number;
  createdMinutesAgo?: number;
  assignees?: number[];
  // Status moves after creation: [status, by user, minutes ago].
  moves?: [string, number, number][];
  checklist?: [string, boolean][];
  comments?: [number, string, number][];
}

function addTask(t: SeedTask) {
  const createdBy = t.createdBy ?? 2;
  const createdAt = ago(t.createdMinutesAgo ?? 180);
  const firstStatus = t.moves?.length ? 'todo' : t.status;
  const r = db.prepare(`
    INSERT INTO tasks (workspace_id, parent_id, title, status, priority, start_date, end_date, due_date,
                       position, created_by, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks), ?, ?, ?)
  `).run(t.parent ?? null, t.title, t.status, t.priority ?? 'none', day(0), day(0),
    t.due === undefined ? null : day(t.due), createdBy, createdAt, createdAt);
  const id = Number(r.lastInsertRowid);

  const event = db.prepare(
    'INSERT INTO task_events (task_id, actor_id, kind, from_value, to_value, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  event.run(id, createdBy, 'created', null, firstStatus, createdAt);
  let from = firstStatus;
  for (const [to, by, minutesAgo] of t.moves ?? []) {
    event.run(id, by, 'status', from, to, ago(minutesAgo));
    from = to;
  }
  for (const userId of t.assignees ?? []) {
    db.prepare('INSERT INTO task_assignees (task_id, user_id, assigned_at) VALUES (?, ?, ?)').run(id, userId, createdAt);
  }
  (t.checklist ?? []).forEach(([text, done], i) => {
    db.prepare('INSERT INTO checklist_items (task_id, text, done, position) VALUES (?, ?, ?, ?)').run(id, text, done ? 1 : 0, i);
  });
  for (const [author, body, minutesAgo] of t.comments ?? []) {
    db.prepare('INSERT INTO comments (task_id, author_id, body, created_at) VALUES (?, ?, ?, ?)').run(id, author, body, ago(minutesAgo));
  }
  return id;
}

// Seeds a small demo workspace. Safe to re-run: it wipes and recreates the data.
export function seed() {
  transaction(() => {
    db.exec(`
      DELETE FROM doc_files;
      DELETE FROM attachments;
      DELETE FROM comments;
      DELETE FROM checklist_items;
      DELETE FROM task_events;
      DELETE FROM task_assignees;
      DELETE FROM task_labels;
      DELETE FROM labels;
      DELETE FROM memberships;
      DELETE FROM docs;
      DELETE FROM notification_prefs;
      DELETE FROM notifications;
      DELETE FROM change_requests;
      DELETE FROM tasks;
      DELETE FROM clients;
      DELETE FROM users;
      DELETE FROM workspaces;
    `);

    db.prepare('INSERT INTO workspaces (id, name, invite_code) VALUES (?, ?, ?)').run(1, 'software', newInviteCode());

    const addUser = db.prepare('INSERT INTO users (id, workspace_id, name, email) VALUES (?, 1, ?, ?)');
    addUser.run(1, 'Chirag Kumar', 'chiragkumar@intellicar.in');
    addUser.run(2, 'Joseph MJ', 'joseph@intellicar.in');
    db.exec('INSERT INTO memberships (workspace_id, user_id) SELECT workspace_id, id FROM users');
    seedClients();
    seedWorkspaceExtras();

    const karan = 3;
    addTask({ title: 'test', status: 'backlog' });
    addTask({ title: 'test apiiii', status: 'todo', createdMinutesAgo: 30 });
    addTask({ title: 'this is the first line', status: 'todo', due: -2, assignees: [2] });
    addTask({ title: 'this is the second line', status: 'todo', priority: 'medium', due: -5 });
    addTask({ title: 'meeting task', status: 'todo' });
    addTask({ title: 'is it worth???', status: 'todo' });
    addTask({ title: 'this is a sample note. what is the real purpose?', status: 'todo' });
    const editing = addTask({ title: 'editing', status: 'todo' });
    addTask({ title: 'this is a sub task', status: 'todo', priority: 'low', parent: editing });
    addTask({ title: 'write release notes', status: 'todo' });
    addTask({ title: 'test', status: 'in_progress', createdMinutesAgo: 233, moves: [['in_progress', karan, 70]] });
    addTask({
      title: 'what is this feature', status: 'testing', createdMinutesAgo: 60 * 26,
      moves: [['in_progress', 2, 60 * 24], ['testing', 2, 60 * 20]],
      checklist: [['Check it against the spec', false]],
      comments: [[2, 'Does anyone know who asked for this?', 60 * 19]],
    });
    addTask({
      title: 'task number 3', status: 'done', priority: 'medium', due: 23, assignees: [2, karan],
      moves: [['in_progress', 2, 150], ['done', karan, 40]],
    });
    addTask({ title: 'canced task number', status: 'canceled', assignees: [2], moves: [['canceled', 2, 20]] });
  });
}

export function seedClients() {
  const addClient = db.prepare(
    'INSERT INTO clients (id, workspace_id, name, color, created_at) VALUES (?, 1, ?, ?, ?)',
  );
  const aryan = newClientId();
  addClient.run(aryan, 'Aryan', '#7a1ef0', '2026-09-30 10:00:00');
  addClient.run(newClientId(), 'second client', '#ea7a0c', '2026-09-30 10:05:00');
  db.prepare(`
    INSERT INTO docs (id, workspace_id, client_id, title, content_html, created_by, updated_by)
    VALUES (?, 1, ?, 'Test doc', '<p>Notes for Aryan.</p>', (SELECT MIN(id) FROM users), (SELECT MIN(id) FROM users))
  `).run(newPublicId(), aryan);
}

// The workspace owner, one more member, and a starter label.
export function seedWorkspaceExtras() {
  const addUser = db.prepare('INSERT OR IGNORE INTO users (workspace_id, name, email) VALUES (1, ?, ?)');
  addUser.run('Karan Aneja', 'karan@intellicar.in');
  addUser.run('Jay Shrivastava', 'jay@intellicar.in');
  const idOf = (email: string) => (db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number }).id;

  const join = db.prepare(`
    INSERT INTO memberships (workspace_id, user_id, role, joined_at) VALUES (1, ?, ?, ?)
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role, joined_at = excluded.joined_at
  `);
  join.run(idOf('karan@intellicar.in'), 'owner', '2026-09-01 09:00:00');
  join.run(idOf('jay@intellicar.in'), 'member', '2026-09-02 09:00:00');
  join.run(idOf('chiragkumar@intellicar.in'), 'member', '2026-09-03 09:00:00');
  join.run(idOf('joseph@intellicar.in'), 'member', '2026-09-04 09:00:00');

  db.prepare("INSERT OR IGNORE INTO labels (workspace_id, name, color) VALUES (1, 'first label', '#ef4444')").run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed();
  console.log('Database seeded.');
}
