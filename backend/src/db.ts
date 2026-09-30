import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(here, '../data');
export const DB_PATH = process.env.DB_PATH ?? resolve(DATA_DIR, 'tasks.db');
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? resolve(DATA_DIR, 'uploads');

mkdirSync(dirname(DB_PATH), { recursive: true });
mkdirSync(UPLOADS_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

export const STATUSES = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'todo', label: 'To do' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'testing', label: 'Testing & Validation' },
  { key: 'done', label: 'Done' },
  { key: 'canceled', label: 'Canceled' },
] as const;

export const PRIORITIES = [
  { key: 'urgent', label: 'Urgent' },
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
  { key: 'none', label: 'No priority' },
] as const;

// Statuses that count as "closed" — everything else is an open task.
export const CLOSED_STATUSES = ['done', 'canceled'];

// No 0/O/1/I so codes survive being read aloud or typed from a screenshot.
export function newInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
}

// Short, URL-friendly ids like "ttnnueod7psnqu3nej5ugekt" for records that appear in URLs.
export function newPublicId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(randomBytes(24), (b) => alphabet[b % alphabet.length]).join('');
}

// Runs fn in a transaction, rolling back if it throws.
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const hasColumn = (table: string, column: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);

// Each migration runs once, in order; PRAGMA user_version records how many have run.
// Never edit a migration that has shipped — add a new one instead.
const MIGRATIONS: (() => void)[] = [
  // 1 — the schema as it stood before versioning. Written to be idempotent because
  //     databases from that time already have some of it.
  () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id   INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id           INTEGER PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
        name         TEXT NOT NULL,
        email        TEXT NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id           INTEGER PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
        parent_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        title        TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'todo'
                     CHECK (status IN ('backlog','todo','in_progress','testing','done','canceled')),
        priority     TEXT NOT NULL DEFAULT 'none'
                     CHECK (priority IN ('none','low','medium','high','urgent')),
        start_date   TEXT,
        due_date     TEXT,
        assignee_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        manager_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by   INTEGER NOT NULL REFERENCES users(id),
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS change_requests (
        id           INTEGER PRIMARY KEY,
        task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        requested_by INTEGER NOT NULL REFERENCES users(id),
        note         TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('mention','assignment','update')),
        message    TEXT NOT NULL,
        task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        is_read    INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS clients (
        id           TEXT PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
        name         TEXT NOT NULL,
        email        TEXT NOT NULL DEFAULT '',
        phone        TEXT NOT NULL DEFAULT '',
        notes        TEXT NOT NULL DEFAULT '',
        color        TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS docs (
        id           INTEGER PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
        client_id    TEXT REFERENCES clients(id) ON DELETE SET NULL,
        title        TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS memberships (
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
        joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (workspace_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS labels (
        id           INTEGER PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        color        TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS task_labels (
        task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, label_id)
      );

      CREATE INDEX IF NOT EXISTS idx_notif_user    ON notifications(user_id, is_read);
      CREATE INDEX IF NOT EXISTS idx_clients_ws    ON clients(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_docs_client   ON docs(client_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_name ON labels(workspace_id, name COLLATE NOCASE);

      -- Anyone already in a workspace from before memberships existed becomes a member of it.
      INSERT OR IGNORE INTO memberships (workspace_id, user_id)
        SELECT workspace_id, id FROM users;
    `);

    if (!hasColumn('tasks', 'client_id')) {
      db.exec('ALTER TABLE tasks ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE SET NULL');
    }
    if (!hasColumn('workspaces', 'invite_code')) {
      db.exec('ALTER TABLE workspaces ADD COLUMN invite_code TEXT');
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_invite ON workspaces(invite_code)');
    for (const { id } of db.prepare('SELECT id FROM workspaces WHERE invite_code IS NULL').all() as { id: number }[]) {
      db.prepare('UPDATE workspaces SET invite_code = ? WHERE id = ?').run(newInviteCode(), id);
    }
  },

  // 2 — tasks get a description, a required start/end range, many assignees, a column
  //     position, and a full history. Also adds checklists, comments and attachments.
  () => {
    db.exec(`
      CREATE TABLE tasks_new (
        id           INTEGER PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        parent_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        client_id    TEXT REFERENCES clients(id) ON DELETE SET NULL,
        title        TEXT NOT NULL,
        description  TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL DEFAULT 'todo'
                     CHECK (status IN ('backlog','todo','in_progress','testing','done','canceled')),
        priority     TEXT NOT NULL DEFAULT 'none'
                     CHECK (priority IN ('urgent','high','medium','low','none')),
        start_date   TEXT NOT NULL,
        end_date     TEXT NOT NULL,
        due_date     TEXT,
        -- Sort order within a status column; new and moved tasks go to the bottom.
        position     REAL NOT NULL DEFAULT 0,
        created_by   INTEGER NOT NULL REFERENCES users(id),
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (end_date >= start_date)
      );

      INSERT INTO tasks_new (id, workspace_id, parent_id, client_id, title, status, priority,
                             start_date, end_date, due_date, position, created_by, created_at, updated_at)
        SELECT id, workspace_id, parent_id, client_id, title, status, priority,
               COALESCE(start_date, date(created_at)), COALESCE(start_date, date(created_at)),
               due_date, id, created_by, created_at, created_at
          FROM tasks;

      CREATE TABLE task_assignees (
        task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (task_id, user_id)
      );

      INSERT INTO task_assignees (task_id, user_id, assigned_at)
        SELECT id, assignee_id, created_at FROM tasks WHERE assignee_id IS NOT NULL;

      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;

      CREATE INDEX idx_tasks_board  ON tasks(workspace_id, status, position);
      CREATE INDEX idx_tasks_parent ON tasks(parent_id);
      CREATE INDEX idx_tasks_client ON tasks(client_id);
      CREATE INDEX idx_assignees_user ON task_assignees(user_id);

      -- One row per change. Status rows are what the History tab's stages are built from.
      CREATE TABLE task_events (
        id         INTEGER PRIMARY KEY,
        task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        actor_id   INTEGER NOT NULL REFERENCES users(id),
        kind       TEXT NOT NULL CHECK (kind IN (
                     'created','status','priority','title','description','client',
                     'start_date','end_date','due_date',
                     'assignee_added','assignee_removed','label_added','label_removed')),
        from_value TEXT,
        to_value   TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_events_task ON task_events(task_id, created_at, id);

      -- Existing tasks start their history at creation, in the status they're in now.
      INSERT INTO task_events (task_id, actor_id, kind, to_value, created_at)
        SELECT id, created_by, 'created', status, created_at FROM tasks;

      CREATE TABLE checklist_items (
        id         INTEGER PRIMARY KEY,
        task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        text       TEXT NOT NULL,
        done       INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
        position   REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_checklist_task ON checklist_items(task_id, position);

      CREATE TABLE comments (
        id         INTEGER PRIMARY KEY,
        task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        author_id  INTEGER NOT NULL REFERENCES users(id),
        body       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_comments_task ON comments(task_id, created_at);

      -- File bytes live on disk under data/uploads/<storage_key>.
      CREATE TABLE attachments (
        id          INTEGER PRIMARY KEY,
        task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        uploaded_by INTEGER NOT NULL REFERENCES users(id),
        filename    TEXT NOT NULL,
        mime_type   TEXT NOT NULL,
        size        INTEGER NOT NULL,
        storage_key TEXT NOT NULL UNIQUE,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_attachments_task ON attachments(task_id);

      ALTER TABLE change_requests ADD COLUMN resolved_by INTEGER REFERENCES users(id);
      ALTER TABLE change_requests ADD COLUMN resolved_at TEXT;
      CREATE INDEX idx_change_requests_task ON change_requests(task_id, status);
    `);
  },

  // 3 — docs become real documents: URL-friendly ids, written content or an uploaded file,
  //     who created/last edited them, and a version number so autosave can't clobber edits.
  () => {
    db.exec(`
      CREATE TABLE docs_new (
        id           TEXT PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        client_id    TEXT REFERENCES clients(id) ON DELETE SET NULL,
        -- 'page' is written in the editor; 'upload' wraps a single uploaded file.
        kind         TEXT NOT NULL DEFAULT 'page' CHECK (kind IN ('page','upload')),
        title        TEXT NOT NULL,
        content_html TEXT NOT NULL DEFAULT '',
        version      INTEGER NOT NULL DEFAULT 1,
        created_by   INTEGER NOT NULL REFERENCES users(id),
        updated_by   INTEGER NOT NULL REFERENCES users(id),
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Older docs had no author; credit the workspace owner (or first member).
      INSERT INTO docs_new (id, workspace_id, client_id, title, created_by, updated_by, created_at, updated_at)
        SELECT lower(hex(randomblob(12))), d.workspace_id, d.client_id, d.title, a.user_id, a.user_id, d.created_at, d.created_at
          FROM docs d
          JOIN (SELECT workspace_id,
                       (SELECT user_id FROM memberships m2 WHERE m2.workspace_id = m.workspace_id
                         ORDER BY m2.role = 'owner' DESC, m2.joined_at LIMIT 1) AS user_id
                  FROM memberships m GROUP BY workspace_id) a ON a.workspace_id = d.workspace_id;

      DROP TABLE docs;
      ALTER TABLE docs_new RENAME TO docs;
      CREATE INDEX idx_docs_ws     ON docs(workspace_id, updated_at);
      CREATE INDEX idx_docs_client ON docs(client_id);

      -- Bytes live on disk under data/uploads/<storage_key>. 'source' is an upload doc's file;
      -- 'embed' is a file placed inside a written doc.
      CREATE TABLE doc_files (
        id          INTEGER PRIMARY KEY,
        doc_id      TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
        role        TEXT NOT NULL CHECK (role IN ('source','embed')),
        uploaded_by INTEGER NOT NULL REFERENCES users(id),
        filename    TEXT NOT NULL,
        mime_type   TEXT NOT NULL,
        size        INTEGER NOT NULL,
        storage_key TEXT NOT NULL UNIQUE,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_doc_files_doc ON doc_files(doc_id);
      CREATE UNIQUE INDEX idx_doc_files_source ON doc_files(doc_id) WHERE role = 'source';
    `);
  },

  // 4 — notifications get a type per setting, who caused them, the workspace they belong to,
  //     and a read time; plus per-user choices for which ones pop up on the desktop.
  () => {
    db.exec(`
      CREATE TABLE notifications_new (
        id           INTEGER PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        kind         TEXT NOT NULL CHECK (kind IN (
                       'mention','assignment','status_change','due_reminder','change_request','request_decision')),
        actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        task_id      INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        -- e.g. the old and new status, a due date, or 'approved' / 'rejected'
        from_value   TEXT,
        to_value     TEXT,
        -- Plain-text version for desktop pop-ups.
        message      TEXT NOT NULL,
        read_at      TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Old rows only had three loose kinds; sort them into the new ones by their wording.
      INSERT INTO notifications_new (id, user_id, workspace_id, kind, task_id, message, read_at, created_at)
        SELECT n.id, n.user_id, COALESCE(t.workspace_id, u.workspace_id),
               CASE
                 WHEN n.kind = 'mention' THEN 'mention'
                 WHEN n.message LIKE '%asked to be assigned%' THEN 'change_request'
                 WHEN n.message LIKE '%your request%' THEN 'request_decision'
                 WHEN n.kind = 'assignment' THEN 'assignment'
                 ELSE 'status_change'
               END,
               n.task_id, n.message, CASE WHEN n.is_read = 1 THEN n.created_at END, n.created_at
          FROM notifications n
          JOIN users u ON u.id = n.user_id
          LEFT JOIN tasks t ON t.id = n.task_id;

      DROP TABLE notifications;
      ALTER TABLE notifications_new RENAME TO notifications;
      CREATE INDEX idx_notif_inbox ON notifications(user_id, workspace_id, id);
      CREATE INDEX idx_notif_unread ON notifications(user_id, workspace_id) WHERE read_at IS NULL;
      -- One reminder per person, per task, per due date.
      CREATE UNIQUE INDEX idx_notif_due ON notifications(user_id, task_id, to_value) WHERE kind = 'due_reminder';

      -- Which notifications pop up on the desktop. No row means everything is on.
      CREATE TABLE notification_prefs (
        user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        mentions          INTEGER NOT NULL DEFAULT 1 CHECK (mentions IN (0, 1)),
        assignments       INTEGER NOT NULL DEFAULT 1 CHECK (assignments IN (0, 1)),
        status_changes    INTEGER NOT NULL DEFAULT 1 CHECK (status_changes IN (0, 1)),
        due_reminders     INTEGER NOT NULL DEFAULT 1 CHECK (due_reminders IN (0, 1)),
        change_requests   INTEGER NOT NULL DEFAULT 1 CHECK (change_requests IN (0, 1)),
        request_decisions INTEGER NOT NULL DEFAULT 1 CHECK (request_decisions IN (0, 1))
      );
    `);
  },
];

function migrate() {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    // Table rebuilds need foreign keys off, and that can't change inside a transaction.
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      transaction(() => {
        MIGRATIONS[v]!();
        const broken = db.prepare('PRAGMA foreign_key_check').all();
        if (broken.length > 0) {
          throw new Error(`Migration ${v + 1} left broken foreign keys: ${JSON.stringify(broken.slice(0, 5))}`);
        }
        db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

migrate();
db.exec('PRAGMA foreign_keys = ON;');
