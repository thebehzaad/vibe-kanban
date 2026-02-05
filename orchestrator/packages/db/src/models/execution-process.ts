/**
 * ExecutionProcess model
 * Translates: crates/db/src/models/execution_process.rs
 */

import * as crypto from 'node:crypto';
import type { DBService } from '../connection.js';

export type ExecutionProcessStatus = 'running' | 'completed' | 'failed' | 'killed';

export type ExecutionProcessRunReason =
  | 'setupscript'
  | 'cleanupscript'
  | 'archivescript'
  | 'codingagent'
  | 'devserver';

export interface ExecutionProcess {
  id: string;
  sessionId: string;
  runReason: ExecutionProcessRunReason;
  executorAction: unknown;
  status: ExecutionProcessStatus;
  exitCode?: number;
  dropped: boolean;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExecutionProcess {
  sessionId: string;
  executorAction: unknown;
  runReason: ExecutionProcessRunReason;
}

export interface CreateExecutionProcessRepoState {
  repoId: string;
  beforeHeadCommit?: string;
  afterHeadCommit?: string;
}

export interface ExecutionProcessRepoState {
  id: string;
  executionProcessId: string;
  repoId: string;
  beforeHeadCommit?: string;
  afterHeadCommit?: string;
  createdAt: string;
}

export interface LatestProcessInfo {
  workspaceId: string;
  executionProcessId: string;
  sessionId: string;
  status: ExecutionProcessStatus;
  completedAt?: string;
}

interface ExecutionProcessRow {
  id: string;
  session_id: string;
  run_reason: string;
  executor_action: string;
  status: string;
  exit_code: number | null;
  dropped: number;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToExecutionProcess(row: ExecutionProcessRow): ExecutionProcess {
  return {
    id: row.id,
    sessionId: row.session_id,
    runReason: row.run_reason as ExecutionProcessRunReason,
    executorAction: JSON.parse(row.executor_action),
    status: row.status as ExecutionProcessStatus,
    exitCode: row.exit_code ?? undefined,
    dropped: row.dropped !== 0,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class ExecutionProcessRepository {
  constructor(private db: DBService) {}

  /**
   * Find execution process by ID
   */
  findById(id: string): ExecutionProcess | undefined {
    const row = this.db.database.prepare(`
      SELECT id, session_id, run_reason, executor_action, status, exit_code,
             dropped, started_at, completed_at, created_at, updated_at
      FROM execution_processes
      WHERE id = ?
    `).get(id) as ExecutionProcessRow | undefined;

    return row ? rowToExecutionProcess(row) : undefined;
  }

  /**
   * Find all execution processes for a session
   */
  findBySessionId(sessionId: string, showSoftDeleted: boolean = false): ExecutionProcess[] {
    const rows = this.db.database.prepare(`
      SELECT id, session_id, run_reason, executor_action, status, exit_code,
             dropped, started_at, completed_at, created_at, updated_at
      FROM execution_processes
      WHERE session_id = ? AND (? OR dropped = 0)
      ORDER BY created_at ASC
    `).all(sessionId, showSoftDeleted ? 1 : 0) as ExecutionProcessRow[];

    return rows.map(rowToExecutionProcess);
  }

  /**
   * Find running execution processes
   */
  findRunning(): ExecutionProcess[] {
    const rows = this.db.database.prepare(`
      SELECT id, session_id, run_reason, executor_action, status, exit_code,
             dropped, started_at, completed_at, created_at, updated_at
      FROM execution_processes
      WHERE status = 'running'
      ORDER BY created_at ASC
    `).all() as ExecutionProcessRow[];

    return rows.map(rowToExecutionProcess);
  }

  /**
   * Find running dev servers for a specific project
   */
  findRunningDevServersByProject(projectId: string): ExecutionProcess[] {
    const rows = this.db.database.prepare(`
      SELECT ep.id, ep.session_id, ep.run_reason, ep.executor_action, ep.status, ep.exit_code,
             ep.dropped, ep.started_at, ep.completed_at, ep.created_at, ep.updated_at
      FROM execution_processes ep
      JOIN sessions s ON ep.session_id = s.id
      JOIN workspaces w ON s.workspace_id = w.id
      JOIN tasks t ON w.task_id = t.id
      WHERE ep.status = 'running' AND ep.run_reason = 'devserver' AND t.project_id = ?
      ORDER BY ep.created_at ASC
    `).all(projectId) as ExecutionProcessRow[];

    return rows.map(rowToExecutionProcess);
  }

  /**
   * Find running dev servers for a specific workspace
   */
  findRunningDevServersByWorkspace(workspaceId: string): ExecutionProcess[] {
    const rows = this.db.database.prepare(`
      SELECT ep.id, ep.session_id, ep.run_reason, ep.executor_action, ep.status, ep.exit_code,
             ep.dropped, ep.started_at, ep.completed_at, ep.created_at, ep.updated_at
      FROM execution_processes ep
      JOIN sessions s ON ep.session_id = s.id
      WHERE s.workspace_id = ? AND ep.status = 'running' AND ep.run_reason = 'devserver'
      ORDER BY ep.created_at DESC
    `).all(workspaceId) as ExecutionProcessRow[];

    return rows.map(rowToExecutionProcess);
  }

  /**
   * Check if there are running non-dev server processes for a workspace
   */
  hasRunningNonDevServerProcessesForWorkspace(workspaceId: string): boolean {
    const row = this.db.database.prepare(`
      SELECT COUNT(*) as count
      FROM execution_processes ep
      JOIN sessions s ON ep.session_id = s.id
      WHERE s.workspace_id = ? AND ep.status = 'running' AND ep.run_reason != 'devserver'
    `).get(workspaceId) as { count: number };
    return row.count > 0;
  }

  /**
   * Find latest execution process by session and run reason
   */
  findLatestBySessionAndRunReason(
    sessionId: string,
    runReason: ExecutionProcessRunReason
  ): ExecutionProcess | undefined {
    const row = this.db.database.prepare(`
      SELECT id, session_id, run_reason, executor_action, status, exit_code,
             dropped, started_at, completed_at, created_at, updated_at
      FROM execution_processes
      WHERE session_id = ? AND run_reason = ? AND dropped = 0
      ORDER BY created_at DESC
      LIMIT 1
    `).get(sessionId, runReason) as ExecutionProcessRow | undefined;

    return row ? rowToExecutionProcess(row) : undefined;
  }

  /**
   * Find latest execution process by workspace and run reason
   */
  findLatestByWorkspaceAndRunReason(
    workspaceId: string,
    runReason: ExecutionProcessRunReason
  ): ExecutionProcess | undefined {
    const row = this.db.database.prepare(`
      SELECT ep.id, ep.session_id, ep.run_reason, ep.executor_action, ep.status, ep.exit_code,
             ep.dropped, ep.started_at, ep.completed_at, ep.created_at, ep.updated_at
      FROM execution_processes ep
      JOIN sessions s ON ep.session_id = s.id
      WHERE s.workspace_id = ? AND ep.run_reason = ? AND ep.dropped = 0
      ORDER BY ep.created_at DESC
      LIMIT 1
    `).get(workspaceId, runReason) as ExecutionProcessRow | undefined;

    return row ? rowToExecutionProcess(row) : undefined;
  }

  /**
   * Create a new execution process
   */
  create(
    data: CreateExecutionProcess,
    processId: string,
    repoStates: CreateExecutionProcessRepoState[] = []
  ): ExecutionProcess {
    const now = new Date().toISOString();
    const executorActionJson = JSON.stringify(data.executorAction);

    this.db.database.prepare(`
      INSERT INTO execution_processes (
        id, session_id, run_reason, executor_action,
        status, exit_code, started_at, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      processId,
      data.sessionId,
      data.runReason,
      executorActionJson,
      'running',
      null,
      now,
      null,
      now,
      now
    );

    // Create repo states
    for (const state of repoStates) {
      const stateId = crypto.randomUUID();
      this.db.database.prepare(`
        INSERT INTO execution_process_repo_states (
          id, execution_process_id, repo_id, before_head_commit, after_head_commit, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        stateId,
        processId,
        state.repoId,
        state.beforeHeadCommit ?? null,
        state.afterHeadCommit ?? null,
        now
      );
    }

    return this.findById(processId)!;
  }

  /**
   * Check if execution process was stopped
   */
  wasStopped(id: string): boolean {
    const process = this.findById(id);
    return process !== undefined && (process.status === 'killed' || process.status === 'completed');
  }

  /**
   * Update execution process completion
   */
  updateCompletion(
    id: string,
    status: ExecutionProcessStatus,
    exitCode?: number
  ): void {
    const completedAt = status === 'running' ? null : new Date().toISOString();
    const now = new Date().toISOString();

    this.db.database.prepare(`
      UPDATE execution_processes
      SET status = ?, exit_code = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(status, exitCode ?? null, completedAt, now, id);
  }

  /**
   * Soft-drop processes at and after the specified boundary
   */
  dropAtAndAfter(sessionId: string, boundaryProcessId: string): number {
    const result = this.db.database.prepare(`
      UPDATE execution_processes
      SET dropped = 1
      WHERE session_id = ?
        AND created_at >= (SELECT created_at FROM execution_processes WHERE id = ?)
        AND dropped = 0
    `).run(sessionId, boundaryProcessId);
    return result.changes;
  }

  /**
   * Find workspaces with running dev servers
   */
  findWorkspacesWithRunningDevServers(archived: boolean): Set<string> {
    const rows = this.db.database.prepare(`
      SELECT DISTINCT s.workspace_id
      FROM execution_processes ep
      JOIN sessions s ON ep.session_id = s.id
      JOIN workspaces w ON s.workspace_id = w.id
      WHERE w.archived = ? AND ep.status = 'running' AND ep.run_reason = 'devserver'
    `).all(archived ? 1 : 0) as { workspace_id: string }[];

    return new Set(rows.map(r => r.workspace_id));
  }
}
