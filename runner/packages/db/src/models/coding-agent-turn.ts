/**
 * Coding agent turn model
 * Translates: crates/db/src/models/coding_agent_turn.rs
 */

import type { DatabaseType } from '../connection.js';
import { randomUUID } from 'node:crypto';

// --- Types ---

export interface CodingAgentTurn {
  id: string;
  executionProcessId: string;
  agentSessionId?: string;
  agentMessageId?: string;
  prompt?: string;
  summary?: string;
  seen: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCodingAgentTurn {
  executionProcessId: string;
  prompt?: string;
}

export interface CodingAgentResumeInfo {
  sessionId: string;
  messageId?: string;
}

// --- Row mapping ---

function rowToTurn(row: any): CodingAgentTurn {
  return {
    id: row.id,
    executionProcessId: row.execution_process_id,
    agentSessionId: row.agent_session_id ?? undefined,
    agentMessageId: row.agent_message_id ?? undefined,
    prompt: row.prompt ?? undefined,
    summary: row.summary ?? undefined,
    seen: !!row.seen,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Repository ---

export class CodingAgentTurnRepository {
  constructor(private db: DatabaseType) {}

  findLatestSessionInfo(sessionId: string): CodingAgentResumeInfo | undefined {
    const row = this.db
      .prepare(
        `SELECT
          cat.agent_session_id as session_id,
          cat.agent_message_id as message_id
        FROM execution_processes ep
        JOIN coding_agent_turns cat ON ep.id = cat.execution_process_id
        WHERE ep.session_id = ?
          AND ep.run_reason = 'codingagent'
          AND ep.dropped = 0
          AND cat.agent_session_id IS NOT NULL
        ORDER BY ep.created_at DESC
        LIMIT 1`,
      )
      .get(sessionId) as any;

    if (!row) return undefined;
    return {
      sessionId: row.session_id,
      messageId: row.message_id ?? undefined,
    };
  }

  findByExecutionProcessId(executionProcessId: string): CodingAgentTurn | undefined {
    const row = this.db
      .prepare('SELECT * FROM coding_agent_turns WHERE execution_process_id = ?')
      .get(executionProcessId) as any;
    return row ? rowToTurn(row) : undefined;
  }

  findByAgentSessionId(agentSessionId: string): CodingAgentTurn | undefined {
    const row = this.db
      .prepare(
        'SELECT * FROM coding_agent_turns WHERE agent_session_id = ? ORDER BY updated_at DESC LIMIT 1',
      )
      .get(agentSessionId) as any;
    return row ? rowToTurn(row) : undefined;
  }

  create(data: CreateCodingAgentTurn, id?: string): CodingAgentTurn {
    const turnId = id ?? randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO coding_agent_turns (
          id, execution_process_id, agent_session_id, agent_message_id, prompt, summary, seen,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(turnId, data.executionProcessId, null, null, data.prompt ?? null, null, 0, now, now);

    return {
      id: turnId,
      executionProcessId: data.executionProcessId,
      prompt: data.prompt,
      seen: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateAgentSessionId(executionProcessId: string, agentSessionId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE coding_agent_turns SET agent_session_id = ?, updated_at = ? WHERE execution_process_id = ?',
      )
      .run(agentSessionId, now, executionProcessId);
  }

  updateAgentMessageId(executionProcessId: string, agentMessageId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE coding_agent_turns SET agent_message_id = ?, updated_at = ? WHERE execution_process_id = ?',
      )
      .run(agentMessageId, now, executionProcessId);
  }

  updateSummary(executionProcessId: string, summary: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE coding_agent_turns SET summary = ?, updated_at = ? WHERE execution_process_id = ?',
      )
      .run(summary, now, executionProcessId);
  }

  markSeenByWorkspaceId(workspaceId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE coding_agent_turns
         SET seen = 1, updated_at = ?
         WHERE execution_process_id IN (
           SELECT ep.id FROM execution_processes ep
           JOIN sessions s ON ep.session_id = s.id
           WHERE s.workspace_id = ?
         ) AND seen = 0`,
      )
      .run(now, workspaceId);
  }

  hasUnseenByWorkspaceId(workspaceId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT EXISTS(
          SELECT 1 FROM coding_agent_turns cat
          JOIN execution_processes ep ON cat.execution_process_id = ep.id
          JOIN sessions s ON ep.session_id = s.id
          WHERE s.workspace_id = ? AND cat.seen = 0
        ) as has_unseen`,
      )
      .get(workspaceId) as any;
    return !!row?.has_unseen;
  }

  findWorkspacesWithUnseen(archived: boolean): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT s.workspace_id
         FROM coding_agent_turns cat
         JOIN execution_processes ep ON cat.execution_process_id = ep.id
         JOIN sessions s ON ep.session_id = s.id
         JOIN workspaces w ON s.workspace_id = w.id
         WHERE cat.seen = 0 AND w.archived = ?`,
      )
      .all(archived ? 1 : 0) as any[];
    return new Set(rows.map((r) => r.workspace_id));
  }
}
