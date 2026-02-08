/**
 * ExecutionProcess model
 * Translates: crates/db/src/models/execution_process.rs
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseType } from '../connection.js';
import type { ExecutorAction, ExecutorActionType } from '@runner/executors';
import type { ExecutorProfileId } from '@runner/executors';
import type { CreateExecutionProcessRepoState } from './execution-process-repo-state.js';
import { ExecutionProcessRepoStateRepository } from './execution-process-repo-state.js';
import type { Session } from './session.js';
import type { Workspace } from './workspace.js';
import type { Task } from './task.js';
import type { Project } from './project.js';
import type { Repo } from './repo.js';
import { rowToRepo } from './repo.js';

// --- Types ---

export type ExecutionProcessStatus = 'running' | 'completed' | 'failed' | 'killed';

export type ExecutionProcessRunReason =
  | 'setupscript'
  | 'cleanupscript'
  | 'archivescript'
  | 'codingagent'
  | 'devserver';

/**
 * Matches Rust #[serde(untagged)] enum ExecutorActionField.
 * When reading from DB, the JSON may be a valid ExecutorAction or some other shape.
 */
export type ExecutorActionField = ExecutorAction | Record<string, unknown>;

export interface ExecutionProcess {
  id: string;
  sessionId: string;
  runReason: ExecutionProcessRunReason;
  executorAction: ExecutorActionField;
  status: ExecutionProcessStatus;
  exitCode?: number;
  /**
   * dropped: true if this process is excluded from the current
   * history view (due to restore/trimming). Hidden from logs/timeline;
   * still listed in the Processes tab.
   */
  dropped: boolean;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExecutionProcess {
  sessionId: string;
  executorAction: ExecutorAction;
  runReason: ExecutionProcessRunReason;
}

export interface ExecutionContext {
  executionProcess: ExecutionProcess;
  session: Session;
  workspace: Workspace;
  task: Task;
  project: Project;
  repos: Repo[];
}

/** Summary info about the latest execution process for a workspace */
export interface LatestProcessInfo {
  workspaceId: string;
  executionProcessId: string;
  sessionId: string;
  status: ExecutionProcessStatus;
  completedAt?: string;
}

export interface MissingBeforeContext {
  id: string;
  sessionId: string;
  workspaceId: string;
  repoId: string;
  prevAfterHeadCommit?: string;
  targetBranch: string;
  repoPath?: string;
}

// --- Row mapping ---

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
    executorAction: JSON.parse(row.executor_action) as ExecutorActionField,
    status: row.status as ExecutionProcessStatus,
    exitCode: row.exit_code ?? undefined,
    dropped: row.dropped !== 0,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Try to extract a typed executor action from the raw JSON field.
 * Matches Rust's ExecutionProcess::executor_action(&self) method.
 */
export function getExecutorAction(process: ExecutionProcess): ExecutorAction | undefined {
  const raw = process.executorAction as any;
  if (raw && typeof raw === 'object' && 'typ' in raw) {
    return raw as ExecutorAction;
  }
  return undefined;
}

// --- Repository ---

export class ExecutionProcessRepository {
  constructor(private db: DatabaseType) {}

  findById(id: string): ExecutionProcess | undefined {
    const row = this.db.prepare(`
      SELECT id, session_id, run_reason, executor_action, status, exit_code,
             dropped, started_at, completed_at, created_at, updated_at
      FROM execution_processes
      WHERE id = ?
    `).get(id) as ExecutionProcessRow | undefined;

    return row ? rowToExecutionProcess(row) : undefined;
  }

  findByRowid(rowid: number): ExecutionProcess | undefined {
    const row = this.db.prepare(`
      SELECT id, session_id, run_reason, executor_action, status, exit_code,
             dropped, started_at, completed_at, created_at, updated_at
      FROM execution_processes
      WHERE rowid = ?
    `).get(rowid) as ExecutionProcessRow | undefined;

    return row ? rowToExecutionProcess(row) : undefined;
  }

  findBySessionId(sessionId: string, showSoftDeleted: boolean = false): ExecutionProcess[] {
    const rows = this.db.prepare(`
      SELECT id, session_id, run_reason, executor_action, status, exit_code,
             dropped, started_at, completed_at, created_at, updated_at
      FROM execution_processes
      WHERE session_id = ? AND (? OR dropped = 0)
      ORDER BY created_at ASC
    `).all(sessionId, showSoftDeleted ? 1 : 0) as ExecutionProcessRow[];

    return rows.map(rowToExecutionProcess);
  }

  findRunning(): ExecutionProcess[] {
    const rows = this.db.prepare(`
      SELECT id, session_id, run_reason, executor_action, status, exit_code,
             dropped, started_at, completed_at, created_at, updated_at
      FROM execution_processes
      WHERE status = 'running'
      ORDER BY created_at ASC
    `).all() as ExecutionProcessRow[];

    return rows.map(rowToExecutionProcess);
  }

  findRunningDevServersByProject(projectId: string): ExecutionProcess[] {
    const rows = this.db.prepare(`
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

  findRunningDevServersByWorkspace(workspaceId: string): ExecutionProcess[] {
    const rows = this.db.prepare(`
      SELECT ep.id, ep.session_id, ep.run_reason, ep.executor_action, ep.status, ep.exit_code,
             ep.dropped, ep.started_at, ep.completed_at, ep.created_at, ep.updated_at
      FROM execution_processes ep
      JOIN sessions s ON ep.session_id = s.id
      WHERE s.workspace_id = ? AND ep.status = 'running' AND ep.run_reason = 'devserver'
      ORDER BY ep.created_at DESC
    `).all(workspaceId) as ExecutionProcessRow[];

    return rows.map(rowToExecutionProcess);
  }

  hasRunningNonDevServerProcessesForWorkspace(workspaceId: string): boolean {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM execution_processes ep
      JOIN sessions s ON ep.session_id = s.id
      WHERE s.workspace_id = ? AND ep.status = 'running' AND ep.run_reason != 'devserver'
    `).get(workspaceId) as { count: number };
    return row.count > 0;
  }

  findLatestBySessionAndRunReason(
    sessionId: string,
    runReason: ExecutionProcessRunReason,
  ): ExecutionProcess | undefined {
    const row = this.db.prepare(`
      SELECT id, session_id, run_reason, executor_action, status, exit_code,
             dropped, started_at, completed_at, created_at, updated_at
      FROM execution_processes
      WHERE session_id = ? AND run_reason = ? AND dropped = 0
      ORDER BY created_at DESC
      LIMIT 1
    `).get(sessionId, runReason) as ExecutionProcessRow | undefined;

    return row ? rowToExecutionProcess(row) : undefined;
  }

  findLatestByWorkspaceAndRunReason(
    workspaceId: string,
    runReason: ExecutionProcessRunReason,
  ): ExecutionProcess | undefined {
    const row = this.db.prepare(`
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
   * Create a new execution process.
   *
   * Note: We intentionally avoid using a transaction here. SQLite update
   * hooks fire during transactions (before commit), and the hook spawns an
   * async task that queries findByRowid on a different connection.
   * If we used a transaction, that query would not see the uncommitted row,
   * causing the WebSocket event to be lost.
   */
  create(
    data: CreateExecutionProcess,
    processId: string,
    repoStates: CreateExecutionProcessRepoState[] = [],
  ): ExecutionProcess {
    const now = new Date().toISOString();
    const executorActionJson = JSON.stringify(data.executorAction);

    this.db.prepare(`
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
      now,
    );

    if (repoStates.length > 0) {
      const repoStateRepo = new ExecutionProcessRepoStateRepository(this.db);
      repoStateRepo.createMany(processId, repoStates);
    }

    return this.findById(processId)!;
  }

  wasStopped(id: string): boolean {
    const process = this.findById(id);
    return process !== undefined && (process.status === 'killed' || process.status === 'completed');
  }

  updateCompletion(
    id: string,
    status: ExecutionProcessStatus,
    exitCode?: number,
  ): void {
    const completedAt = status === 'running' ? null : new Date().toISOString();
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE execution_processes
      SET status = ?, exit_code = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(status, exitCode ?? null, completedAt, now, id);
  }

  dropAtAndAfter(sessionId: string, boundaryProcessId: string): number {
    const result = this.db.prepare(`
      UPDATE execution_processes
      SET dropped = 1
      WHERE session_id = ?
        AND created_at >= (SELECT created_at FROM execution_processes WHERE id = ?)
        AND dropped = 0
    `).run(sessionId, boundaryProcessId);
    return result.changes;
  }

  /**
   * Find the previous process's after_head_commit before the given boundary process
   * for a specific repository.
   * Matches Rust's find_prev_after_head_commit
   */
  findPrevAfterHeadCommit(
    sessionId: string,
    boundaryProcessId: string,
    repoId: string,
  ): string | undefined {
    const row = this.db.prepare(`
      SELECT eprs.after_head_commit
      FROM execution_process_repo_states eprs
      JOIN execution_processes ep ON ep.id = eprs.execution_process_id
      WHERE ep.session_id = ?
        AND eprs.repo_id = ?
        AND ep.created_at < (SELECT created_at FROM execution_processes WHERE id = ?)
      ORDER BY ep.created_at DESC
      LIMIT 1
    `).get(sessionId, repoId, boundaryProcessId) as { after_head_commit: string | null } | undefined;
    return row?.after_head_commit ?? undefined;
  }

  /**
   * Load execution context with related session, workspace, task, project, and repos.
   * Matches Rust's ExecutionProcess::load_context
   */
  loadContext(execId: string): ExecutionContext | undefined {
    const executionProcess = this.findById(execId);
    if (!executionProcess) return undefined;

    const sessionRow = this.db.prepare(
      'SELECT * FROM sessions WHERE id = ?',
    ).get(executionProcess.sessionId) as any;
    if (!sessionRow) return undefined;

    const workspaceRow = this.db.prepare(
      'SELECT * FROM workspaces WHERE id = ?',
    ).get(sessionRow.workspace_id) as any;
    if (!workspaceRow) return undefined;

    const taskRow = this.db.prepare(
      'SELECT * FROM tasks WHERE id = ?',
    ).get(workspaceRow.task_id) as any;
    if (!taskRow) return undefined;

    const projectRow = this.db.prepare(
      'SELECT * FROM projects WHERE id = ?',
    ).get(taskRow.project_id) as any;
    if (!projectRow) return undefined;

    const repoRows = this.db.prepare(`
      SELECT r.* FROM repos r
      JOIN workspace_repos wr ON r.id = wr.repo_id
      WHERE wr.workspace_id = ?
    `).all(workspaceRow.id) as any[];

    // Map rows using the typed interfaces from sibling models.
    // These inline mappings mirror the rowToXxx functions in each model.
    const session: Session = {
      id: sessionRow.id,
      workspaceId: sessionRow.workspace_id,
      executor: sessionRow.executor ?? undefined,
      createdAt: sessionRow.created_at,
      updatedAt: sessionRow.updated_at,
    };

    const workspace: Workspace = {
      id: workspaceRow.id,
      taskId: workspaceRow.task_id,
      containerRef: workspaceRow.container_ref ?? undefined,
      branch: workspaceRow.branch,
      agentWorkingDir: workspaceRow.agent_working_dir ?? undefined,
      setupCompletedAt: workspaceRow.setup_completed_at ?? undefined,
      archived: workspaceRow.archived !== 0,
      pinned: workspaceRow.pinned !== 0,
      name: workspaceRow.name ?? undefined,
      createdAt: workspaceRow.created_at,
      updatedAt: workspaceRow.updated_at,
    };

    const task: Task = {
      id: taskRow.id,
      projectId: taskRow.project_id,
      title: taskRow.title,
      description: taskRow.description ?? undefined,
      status: taskRow.status,
      parentWorkspaceId: taskRow.parent_workspace_id ?? undefined,
      createdAt: taskRow.created_at,
      updatedAt: taskRow.updated_at,
    };

    const project: Project = {
      id: projectRow.id,
      name: projectRow.name,
      defaultAgentWorkingDir: projectRow.default_agent_working_dir ?? undefined,
      remoteProjectId: projectRow.remote_project_id ?? undefined,
      createdAt: projectRow.created_at,
      updatedAt: projectRow.updated_at,
    };

    const repos: Repo[] = repoRows.map((r: any) => rowToRepo(r));

    return {
      executionProcess,
      session,
      workspace,
      task,
      project,
      repos,
    };
  }

  /**
   * Fetch the latest CodingAgent executor profile for a session.
   * Returns undefined if no CodingAgent execution process exists.
   * Matches Rust's latest_executor_profile_for_session
   */
  latestExecutorProfileForSession(sessionId: string): ExecutorProfileId | undefined {
    const process = this.findLatestBySessionAndRunReason(sessionId, 'codingagent');
    if (!process) return undefined;

    const action = getExecutorAction(process);
    if (!action) return undefined;

    const typ = (action as any).typ as ExecutorActionType | undefined;
    if (!typ) return undefined;

    switch (typ.type) {
      case 'CodingAgentInitialRequest':
        return (typ.request as any)?.executorProfileId;
      case 'CodingAgentFollowUpRequest':
        return (typ.request as any)?.executorProfileId;
      case 'ReviewRequest':
        return (typ.request as any)?.executorProfileId;
      default:
        return undefined;
    }
  }

  /**
   * Fetch latest execution process info for all workspaces with the given archived status.
   * Returns a map of workspace_id -> LatestProcessInfo.
   * Matches Rust's find_latest_for_workspaces
   */
  findLatestForWorkspaces(archived: boolean): Map<string, LatestProcessInfo> {
    const rows = this.db.prepare(`
      SELECT
        s.workspace_id,
        ep.id as execution_process_id,
        ep.session_id,
        ep.status,
        ep.completed_at
      FROM execution_processes ep
      JOIN sessions s ON ep.session_id = s.id
      JOIN workspaces w ON s.workspace_id = w.id
      WHERE w.archived = ?
        AND ep.run_reason IN ('codingagent', 'setupscript', 'cleanupscript')
        AND ep.dropped = 0
        AND ep.created_at = (
          SELECT MAX(ep2.created_at)
          FROM execution_processes ep2
          JOIN sessions s2 ON ep2.session_id = s2.id
          WHERE s2.workspace_id = s.workspace_id
            AND ep2.run_reason IN ('codingagent', 'setupscript', 'cleanupscript')
            AND ep2.dropped = 0
        )
    `).all(archived ? 1 : 0) as any[];

    const result = new Map<string, LatestProcessInfo>();
    for (const row of rows) {
      result.set(row.workspace_id, {
        workspaceId: row.workspace_id,
        executionProcessId: row.execution_process_id,
        sessionId: row.session_id,
        status: row.status as ExecutionProcessStatus,
        completedAt: row.completed_at ?? undefined,
      });
    }
    return result;
  }

  /**
   * Find all workspaces with running dev servers, filtered by archived status.
   * Returns a set of workspace IDs.
   * Matches Rust's find_workspaces_with_running_dev_servers
   */
  findWorkspacesWithRunningDevServers(archived: boolean): Set<string> {
    const rows = this.db.prepare(`
      SELECT DISTINCT s.workspace_id
      FROM execution_processes ep
      JOIN sessions s ON ep.session_id = s.id
      JOIN workspaces w ON s.workspace_id = w.id
      WHERE w.archived = ? AND ep.status = 'running' AND ep.run_reason = 'devserver'
    `).all(archived ? 1 : 0) as { workspace_id: string }[];

    return new Set(rows.map(r => r.workspace_id));
  }

  /**
   * List processes that have after_head_commit set but missing before_head_commit.
   * Matches Rust's list_missing_before_context
   */
  listMissingBeforeContext(): MissingBeforeContext[] {
    const rows = this.db.prepare(`
      SELECT
        ep.id,
        ep.session_id,
        s.workspace_id,
        eprs.repo_id,
        eprs.after_head_commit,
        prev.after_head_commit as prev_after_head_commit,
        wr.target_branch,
        r.path as repo_path
      FROM execution_processes ep
      JOIN sessions s ON s.id = ep.session_id
      JOIN execution_process_repo_states eprs ON eprs.execution_process_id = ep.id
      JOIN repos r ON r.id = eprs.repo_id
      JOIN workspaces w ON w.id = s.workspace_id
      JOIN workspace_repos wr ON wr.workspace_id = w.id AND wr.repo_id = eprs.repo_id
      LEFT JOIN execution_process_repo_states prev
        ON prev.execution_process_id = (
          SELECT id FROM execution_processes
            WHERE session_id = ep.session_id
              AND created_at < ep.created_at
            ORDER BY created_at DESC
            LIMIT 1
        )
        AND prev.repo_id = eprs.repo_id
      WHERE eprs.before_head_commit IS NULL
        AND eprs.after_head_commit IS NOT NULL
    `).all() as any[];

    return rows.map((r: any) => ({
      id: r.id,
      sessionId: r.session_id,
      workspaceId: r.workspace_id,
      repoId: r.repo_id,
      prevAfterHeadCommit: r.prev_after_head_commit ?? undefined,
      targetBranch: r.target_branch,
      repoPath: r.repo_path ?? undefined,
    }));
  }
}
