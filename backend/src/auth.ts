import type { Request } from 'express';
import { db } from './db.js';

export interface CurrentUser {
  id: number;
  workspace_id: number;
  name: string;
  email: string;
}

// There's no auth yet — the "current user" is picked via the X-User-Email header,
// falling back to the first user in the database.
export function currentUser(req: Request): CurrentUser | undefined {
  const email = req.header('x-user-email');
  const byEmail = email
    ? db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    : undefined;
  return (byEmail ?? db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get()) as
    | CurrentUser
    | undefined;
}
