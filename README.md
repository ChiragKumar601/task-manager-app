# Task Manager

- `backend/` — Express 5 + SQLite (Node's built-in `node:sqlite`, no DB server needed). Data lives in `backend/data/tasks.db`.
- `frontend/` — React 19 + Vite. Dev server on :3000, proxies `/api` to the backend on :4000.

## Run

```sh
cd backend && pnpm install && pnpm dev     # http://localhost:4000
cd frontend && pnpm install && pnpm dev    # http://localhost:3000
```

The database is created and seeded with demo data on first start. `pnpm seed` (in `backend/`) resets it.
Schema changes are versioned migrations in `backend/src/db.ts` (tracked with `PRAGMA user_version`); add a new
entry to `MIGRATIONS` rather than editing an old one. Attachment files are stored in `backend/data/uploads/`.

## Tasks

- Statuses: Backlog, To do, In progress, Testing & Validation, Done, Canceled.
- Priorities: Urgent, High, Medium, Low, No priority.
- A task's creator, its assignees and workspace owners can change it (including dragging it to another
  status); only the creator can edit its description. Anyone in the workspace can comment or ask to be assigned.
- Every change is written to `task_events`; the History tab groups those into stages (time spent in each status).
- Quick Capture turns one line of notes into one To do task. "Personal" assigns them to you; "From a meeting"
  leaves them unassigned and notes where they came from.

## Inbox

- Notifications: @mentions, being assigned, status changes on tasks you created or are assigned to, due-date
  reminders (open tasks due today or tomorrow, checked every 15 minutes), requests to be assigned on tasks you
  created, and decisions on your own requests. You never get notified about your own actions.
- Desktop pop-ups are switched on per device (browser permission) and only appear while the app isn't the window in
  front. Which kinds pop up is a per-user setting saved on the server; the inbox always shows everything.
- The app checks for new notifications every 15 seconds and whenever the window regains focus.

## Docs

- "+ New doc" makes a written doc; "Upload document" stores a file (up to 10 MB) as a doc of its own, with a
  preview for images, PDFs and plain text.
- Written docs autosave. Each save sends the doc's `version`; if someone else saved in between, the API returns 409
  and the editor asks whether to load their version or keep yours.
- Doc HTML is sanitized with DOMPurify whenever it's loaded or saved (`frontend/src/lib/sanitize.ts`).

## API

- `GET /api/me` — current user, open workspace, and every workspace they belong to (no auth yet; pass `X-User-Email` to switch users)
- `PUT /api/me/workspace` — switch the open workspace (`workspaceId`)
- `POST /api/workspaces` — create a workspace (`name`); you become its owner and it opens
- `POST /api/workspaces/join` — join by invite code (`code`)
- `GET /api/workspace` — open workspace's invite code and members
- `GET /api/labels`, `POST /api/labels` (`name`, `color`), `DELETE /api/labels/:id`
- `GET /api/tasks` — the board: every task card plus members, labels and clients for the filters
- `POST /api/tasks` — create (`title`, `start_date`, `end_date` required; optional `parent_id` for a subtask)
- `GET /api/tasks/:id` — task details, subtasks, checklist, comments, attachments, permissions
- `PATCH /api/tasks/:id` — change any fields; each change is logged
- `DELETE /api/tasks/:id` — creator or workspace owner only
- `GET /api/tasks/:id/history` — the event log the History tab is built from
- `POST /api/tasks/:id/checklist`, `PATCH|DELETE /api/checklist/:itemId`
- `POST /api/tasks/:id/comments` — `@First` or `@First Last` notifies that member
- `POST /api/tasks/:id/attachments` — raw file body, `X-File-Name` / `X-File-Type` headers, max 5 files × 5 MB
- `GET /api/attachments/:id` (download), `DELETE /api/attachments/:id`
- `POST /api/tasks/:id/assign-requests`, `PUT /api/change-requests/:id` (`approved` / `rejected`)
- `POST /api/tasks/bulk` — Quick Capture (`source`: `meeting` | `personal`, `date`, `titles[]`); all or nothing
- `GET /api/notifications` (`filter=unread`, `before`, `after`, `limit`), `POST /api/notifications/:id/read`
  (`{ read: false }` to mark unread), `POST /api/notifications/read-all`
- `GET /api/notification-prefs`, `PUT /api/notification-prefs` (send only the switches that changed)
- `GET /api/docs`, `POST /api/docs`, `GET|PATCH|DELETE /api/docs/:id` (PATCH needs the current `version`)
- `POST /api/docs/upload` — a file as a new doc; `POST /api/docs/:id/files` — a file inside a written doc
- `GET /api/doc-files/:id` — download; `?inline=1` previews images, PDFs and plain text
- `GET /api/dashboard` — everything the home page shows
- `GET /api/clients` — clients with task/doc counts
- `POST /api/clients` — create (`name` required; `email`, `phone`, `notes`, `color`)
- `GET /api/clients/:id` — client + its tasks and docs
- `PUT /api/clients/:id` — update (the edit form's Save)
- `DELETE /api/clients/:id` — delete; its tasks/docs are kept but unlinked
