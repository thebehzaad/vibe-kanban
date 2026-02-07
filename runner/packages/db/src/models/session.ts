/**
 * Session model
 * Translates: crates/db/src/models/session.rs
 */

import * as crypto from 'node:crypto';
import type { DBService } from '../connection.js';

export interface Session {
  id: string;
  workspaceId: string;
  executor?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSession {
  executor?: string;
}

interface SessionRow {
  id: string;
  workspace_id: string;
  executor: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    executor: row.executor ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SessionRepository {
  constructor(private db: DBService) {}

  /**
   * Find session by ID
   */
  findById(id: string): Session | undefined {
    const row = this.db.database.prepare(`
      SELECT id, workspace_id, executor, created_at, updated_at
      FROM sessions
      WHERE id = ?
    `).get(id) as SessionRow | undefined;

    return row ? rowToSession(row) : undefined;
  }

  /**
   * Find all sessions for a workspace, ordered by most recently used.
   */
  findByWorkspaceId(workspaceId: string): Session[] {
    const rows = this.db.database.prepare(`
      SELECT s.id, s.workspace_id, s.executor, s.created_at, s.updated_at
      FROM sessions s
      LEFT JOIN (
        SELECT ep.session_id, MAX(ep.created_at) as last_used
        FROM execution_processes ep
        WHERE ep.run_reason != 'devserver' AND ep.dropped = 0
        GROUP BY ep.session_id
      ) latest_ep ON s.id = latest_ep.session_id
      WHERE s.workspace_id = ?
      ORDER BY COALESCE(latest_ep.last_used, s.created_at) DESC
    `).all(workspaceId) as SessionRow[];

    return rows.map(rowToSession);
  }

  /**
   * Find the most recently used session for a workspace.
   */
  findLatestByWorkspaceId(workspaceId: string): Session | undefined {
    const row = this.db.database.prepare(`
      SELECT s.id, s.workspace_id, s.executor, s.created_at, s.updated_at
      FROM sessions s
      LEFT JOIN (
        SELECT ep.session_id, MAX(ep.created_at) as last_used
        FROM execution_processes ep
        WHERE ep.run_reason != 'devserver' AND ep.dropped = 0
        GROUP BY ep.session_id
      ) latest_ep ON s.id = latest_ep.session_id
      WHERE s.workspace_id = ?
      ORDER BY COALESCE(latest_ep.last_used, s.created_at) DESC
      LIMIT 1
    `).get(workspaceId) as SessionRow | undefined;

    return row ? rowToSession(row) : undefined;
  }

  /**
   * Create a new session
   */
  create(data: CreateSession, sessionId: string, workspaceId: string): Session {
    const now = new Date().toISOString();

    this.db.database.prepare(`
      INSERT INTO sessions (id, workspace_id, executor, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, workspaceId, data.executor ?? null, now, now);

    return this.findById(sessionId)!;
  }

  /**
   * Update session executor
   */
  updateExecutor(id: string, executor: string): void {
    const now = new Date().toISOString();
    this.db.database.prepare(`
      UPDATE sessions SET executor = ?, updated_at = ? WHERE id = ?
    `).run(executor, now, id);
  }

  /**
   * Delete a session
   */
  delete(id: string): number {
    const result = this.db.database.prepare(
      'DELETE FROM sessions WHERE id = ?'
    ).run(id);
    return result.changes;
  }
}
