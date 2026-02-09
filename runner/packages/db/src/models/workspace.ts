/**
 * Workspace model
 * Translates: crates/db/src/models/workspace.rs
 */

import * as nodePath from 'node:path';
import type { DatabaseType } from '../connection.js';
import type { Task } from './task.js';
import type { Project } from './project.js';
import type { RepoWithTargetBranch } from './workspace-repo.js';

const WORKSPACE_NAME_MAX_LEN = 60;

// --- Error ---

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }

  static taskNotFound(): WorkspaceError {
    return new WorkspaceError('Task not found');
  }

  static projectNotFound(): WorkspaceError {
    return new WorkspaceError('Project not found');
  }

  static validationError(msg: string): WorkspaceError {
    return new WorkspaceError(`Validation error: ${msg}`);
  }

  static branchNotFound(branch: string): WorkspaceError {
    return new WorkspaceError(`Branch not found: ${branch}`);
  }
}

// --- Types ---

export interface Workspace {
  id: string;
  taskId: string;
  containerRef?: string;
  branch: string;
  agentWorkingDir?: string;
  setupCompletedAt?: string;
  archived: boolean;
  pinned: boolean;
  name?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceWithStatus extends Workspace {
  isRunning: boolean;
  isErrored: boolean;
}

export interface ContainerInfo {
  workspaceId: string;
  taskId: string;
  projectId: string;
}

export interface WorkspaceContext {
  workspace: Workspace;
  task: Task;
  project: Project;
  workspaceRepos: RepoWithTargetBranch[];
}

export interface CreateFollowUpAttempt {
  prompt: string;
}

export interface AttemptResumeContext {
  executionHistory: string;
  cumulativeDiffs: string;
}

export interface CreatePrParams {
  workspaceId: string;
  taskId: string;
  projectId: string;
  githubToken: string;
  title: string;
  body?: string;
  baseBranch?: string;
}

export interface CreateWorkspace {
  branch: string;
  agentWorkingDir?: string;
}

export interface UpdateWorkspace {
  archived?: boolean;
  pinned?: boolean;
  name?: string;
}

// --- Row mapping ---

interface WorkspaceRow {
  id: string;
  task_id: string;
  container_ref: string | null;
  branch: string;
  agent_working_dir: string | null;
  setup_completed_at: string | null;
  archived: number;
  pinned: number;
  name: string | null;
  created_at: string;
  updated_at: string;
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    taskId: row.task_id,
    containerRef: row.container_ref ?? undefined,
    branch: row.branch,
    agentWorkingDir: row.agent_working_dir ?? undefined,
    setupCompletedAt: row.setup_completed_at ?? undefined,
    archived: row.archived !== 0,
    pinned: row.pinned !== 0,
    name: row.name ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// --- Repository ---

export class WorkspaceRepository {
  constructor(private db: DatabaseType) {}

  static truncateToName(prompt: string, maxLen: number = WORKSPACE_NAME_MAX_LEN): string {
    const trimmed = prompt.trim();
    if (trimmed.length <= maxLen) {
      return trimmed;
    }
    const truncated = trimmed.substring(0, maxLen);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 0) {
      return truncated.substring(0, lastSpace) + '...';
    }
    return truncated + '...';
  }

  countAll(): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM workspaces'
    ).get() as { count: number };
    return row.count;
  }

  fetchAll(taskId?: string): Workspace[] {
    let rows: WorkspaceRow[];

    if (taskId) {
      rows = this.db.prepare(`
        SELECT id, task_id, container_ref, branch, agent_working_dir, setup_completed_at,
               archived, pinned, name, created_at, updated_at
        FROM workspaces
        WHERE task_id = ?
        ORDER BY created_at DESC
      `).all(taskId) as WorkspaceRow[];
    } else {
      rows = this.db.prepare(`
        SELECT id, task_id, container_ref, branch, agent_working_dir, setup_completed_at,
               archived, pinned, name, created_at, updated_at
        FROM workspaces
        ORDER BY created_at DESC
      `).all() as WorkspaceRow[];
    }

    return rows.map(rowToWorkspace);
  }

  findById(id: string): Workspace | undefined {
    const row = this.db.prepare(`
      SELECT id, task_id, container_ref, branch, agent_working_dir, setup_completed_at,
             archived, pinned, name, created_at, updated_at
      FROM workspaces
      WHERE id = ?
    `).get(id) as WorkspaceRow | undefined;

    return row ? rowToWorkspace(row) : undefined;
  }

  findByRowid(rowid: number): Workspace | undefined {
    const row = this.db.prepare(`
      SELECT id, task_id, container_ref, branch, agent_working_dir, setup_completed_at,
             archived, pinned, name, created_at, updated_at
      FROM workspaces
      WHERE rowid = ?
    `).get(rowid) as WorkspaceRow | undefined;

    return row ? rowToWorkspace(row) : undefined;
  }

  findByIdWithStatus(id: string): WorkspaceWithStatus | undefined {
    const row = this.db.prepare(`
      SELECT
        w.id, w.task_id, w.container_ref, w.branch, w.agent_working_dir, w.setup_completed_at,
        w.archived, w.pinned, w.name, w.created_at, w.updated_at,
        CASE WHEN EXISTS (
          SELECT 1
          FROM sessions s
          JOIN execution_processes ep ON ep.session_id = s.id
          WHERE s.workspace_id = w.id
            AND ep.status = 'running'
            AND ep.run_reason IN ('setupscript','cleanupscript','codingagent')
          LIMIT 1
        ) THEN 1 ELSE 0 END as is_running,
        CASE WHEN (
          SELECT ep.status
          FROM sessions s
          JOIN execution_processes ep ON ep.session_id = s.id
          WHERE s.workspace_id = w.id
            AND ep.run_reason IN ('setupscript','cleanupscript','codingagent')
          ORDER BY ep.created_at DESC
          LIMIT 1
        ) IN ('failed','killed') THEN 1 ELSE 0 END as is_errored
      FROM workspaces w
      WHERE w.id = ?
    `).get(id) as (WorkspaceRow & { is_running: number; is_errored: number }) | undefined;

    if (!row) return undefined;

    const ws: WorkspaceWithStatus = {
      ...rowToWorkspace(row),
      isRunning: row.is_running !== 0,
      isErrored: row.is_errored !== 0
    };

    // Auto-populate name from first user message if missing
    if (ws.name === undefined) {
      const prompt = this.getFirstUserMessage(ws.id);
      if (prompt) {
        const name = WorkspaceRepository.truncateToName(prompt, WORKSPACE_NAME_MAX_LEN);
        this.update(ws.id, { name });
        ws.name = name;
      }
    }

    return ws;
  }

  findAllWithStatus(archived?: boolean, limit?: number): WorkspaceWithStatus[] {
    const rows = this.db.prepare(`
      SELECT
        w.id, w.task_id, w.container_ref, w.branch, w.agent_working_dir, w.setup_completed_at,
        w.archived, w.pinned, w.name, w.created_at, w.updated_at,
        CASE WHEN EXISTS (
          SELECT 1
          FROM sessions s
          JOIN execution_processes ep ON ep.session_id = s.id
          WHERE s.workspace_id = w.id
            AND ep.status = 'running'
            AND ep.run_reason IN ('setupscript','cleanupscript','codingagent')
          LIMIT 1
        ) THEN 1 ELSE 0 END as is_running,
        CASE WHEN (
          SELECT ep.status
          FROM sessions s
          JOIN execution_processes ep ON ep.session_id = s.id
          WHERE s.workspace_id = w.id
            AND ep.run_reason IN ('setupscript','cleanupscript','codingagent')
          ORDER BY ep.created_at DESC
          LIMIT 1
        ) IN ('failed','killed') THEN 1 ELSE 0 END as is_errored
      FROM workspaces w
      ORDER BY w.updated_at DESC
    `).all() as (WorkspaceRow & { is_running: number; is_errored: number })[];

    let result = rows.map(row => ({
      ...rowToWorkspace(row),
      isRunning: row.is_running !== 0,
      isErrored: row.is_errored !== 0
    }));

    // Filter by archived if specified
    if (archived !== undefined) {
      result = result.filter(ws => ws.archived === archived);
    }

    // Apply limit if specified
    if (limit !== undefined) {
      result = result.slice(0, limit);
    }

    // Auto-populate names from first user message
    for (const ws of result) {
      if (ws.name === undefined) {
        const prompt = this.getFirstUserMessage(ws.id);
        if (prompt) {
          const name = WorkspaceRepository.truncateToName(prompt, WORKSPACE_NAME_MAX_LEN);
          this.update(ws.id, { name });
          ws.name = name;
        }
      }
    }

    return result;
  }

  containerRefExists(containerRef: string): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM workspaces WHERE container_ref = ? LIMIT 1
    `).get(containerRef);
    return row !== undefined;
  }

  resolveContainerRef(containerRef: string): ContainerInfo | undefined {
    const row = this.db.prepare(`
      SELECT w.id as workspace_id, w.task_id, t.project_id
      FROM workspaces w
      JOIN tasks t ON w.task_id = t.id
      WHERE w.container_ref = ?
    `).get(containerRef) as { workspace_id: string; task_id: string; project_id: string } | undefined;

    if (!row) return undefined;

    return {
      workspaceId: row.workspace_id,
      taskId: row.task_id,
      projectId: row.project_id
    };
  }

  resolveContainerRefByPrefix(path: string): ContainerInfo | undefined {
    // First try exact match
    const exact = this.resolveContainerRef(path);
    if (exact) return exact;

    // Try parent directory
    const parent = nodePath.dirname(path);
    if (parent && parent !== path) {
      return this.resolveContainerRef(parent);
    }

    return undefined;
  }

  loadContext(
    workspaceId: string,
    taskId: string,
    projectId: string,
  ): WorkspaceContext {
    // Validate workspace belongs to task belongs to project via JOIN
    const wsRow = this.db.prepare(`
      SELECT w.id, w.task_id, w.container_ref, w.branch, w.agent_working_dir,
             w.setup_completed_at, w.archived, w.pinned, w.name, w.created_at, w.updated_at
      FROM workspaces w
      JOIN tasks t ON w.task_id = t.id
      JOIN projects p ON t.project_id = p.id
      WHERE w.id = ? AND t.id = ? AND p.id = ?
    `).get(workspaceId, taskId, projectId) as WorkspaceRow | undefined;

    if (!wsRow) throw WorkspaceError.taskNotFound();

    const workspace = rowToWorkspace(wsRow);

    // Load task
    const taskRow = this.db.prepare(`
      SELECT id, project_id, title, description, status, parent_workspace_id, created_at, updated_at
      FROM tasks WHERE id = ?
    `).get(taskId) as any;
    if (!taskRow) throw WorkspaceError.taskNotFound();

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

    // Load project
    const projRow = this.db.prepare(`
      SELECT id, name, default_agent_working_dir, remote_project_id, created_at, updated_at
      FROM projects WHERE id = ?
    `).get(projectId) as any;
    if (!projRow) throw WorkspaceError.projectNotFound();

    const project: Project = {
      id: projRow.id,
      name: projRow.name,
      defaultAgentWorkingDir: projRow.default_agent_working_dir ?? undefined,
      remoteProjectId: projRow.remote_project_id ?? undefined,
      createdAt: projRow.created_at,
      updatedAt: projRow.updated_at,
    };

    // Load workspace repos with target branch
    const repoRows = this.db.prepare(`
      SELECT r.id, r.path, r.name, r.display_name, r.setup_script, r.cleanup_script,
             r.archive_script, r.copy_files, r.parallel_setup_script, r.dev_server_script,
             r.default_target_branch, r.default_working_dir, r.created_at, r.updated_at,
             wr.target_branch
      FROM repos r
      JOIN workspace_repos wr ON r.id = wr.repo_id
      WHERE wr.workspace_id = ?
      ORDER BY r.display_name ASC
    `).all(workspaceId) as any[];

    const workspaceRepos: RepoWithTargetBranch[] = repoRows.map((row: any) => ({
      id: row.id,
      path: row.path,
      name: row.name,
      displayName: row.display_name,
      setupScript: row.setup_script ?? undefined,
      cleanupScript: row.cleanup_script ?? undefined,
      archiveScript: row.archive_script ?? undefined,
      copyFiles: row.copy_files ?? undefined,
      parallelSetupScript: row.parallel_setup_script !== 0,
      devServerScript: row.dev_server_script ?? undefined,
      defaultTargetBranch: row.default_target_branch ?? undefined,
      defaultWorkingDir: row.default_working_dir ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      targetBranch: row.target_branch,
    }));

    return { workspace, task, project, workspaceRepos };
  }

  findExpiredForCleanup(): Workspace[] {
    const rows = this.db.prepare(`
      SELECT
        w.id, w.task_id, w.container_ref, w.branch, w.agent_working_dir,
        w.setup_completed_at, w.archived, w.pinned, w.name, w.created_at, w.updated_at
      FROM workspaces w
      JOIN tasks t ON w.task_id = t.id
      LEFT JOIN sessions s ON w.id = s.workspace_id
      LEFT JOIN execution_processes ep ON s.id = ep.session_id AND ep.completed_at IS NOT NULL
      WHERE w.container_ref IS NOT NULL
        AND w.id NOT IN (
          SELECT DISTINCT s2.workspace_id
          FROM sessions s2
          JOIN execution_processes ep2 ON s2.id = ep2.session_id
          WHERE ep2.completed_at IS NULL
        )
      GROUP BY w.id, w.container_ref, w.updated_at
      HAVING datetime('now', 'localtime',
        CASE
          WHEN w.archived = 1 OR t.status NOT IN ('inprogress', 'inreview')
          THEN '-1 hours'
          ELSE '-72 hours'
        END
      ) > datetime(
        MAX(
          max(
            datetime(w.updated_at),
            datetime(ep.completed_at)
          )
        )
      )
      ORDER BY MAX(
        CASE
          WHEN ep.completed_at IS NOT NULL THEN ep.completed_at
          ELSE w.updated_at
        END
      ) ASC
    `).all() as WorkspaceRow[];

    return rows.map(rowToWorkspace);
  }

  getFirstUserMessage(workspaceId: string): string | undefined {
    const result = this.db.prepare(`
      SELECT cat.prompt
      FROM sessions s
      JOIN execution_processes ep ON ep.session_id = s.id
      JOIN coding_agent_turns cat ON cat.execution_process_id = ep.id
      WHERE s.workspace_id = ?
        AND s.executor IS NOT NULL
        AND cat.prompt IS NOT NULL
      ORDER BY s.created_at ASC, ep.created_at ASC
      LIMIT 1
    `).get(workspaceId) as { prompt: string | null } | undefined;

    return result?.prompt ?? undefined;
  }

  create(data: CreateWorkspace, workspaceId: string, taskId: string): Workspace {
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO workspaces (id, task_id, container_ref, branch, agent_working_dir, setup_completed_at, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, NULL, ?, ?)
    `).run(workspaceId, taskId, data.branch, data.agentWorkingDir ?? null, now, now);

    return this.findById(workspaceId)!;
  }

  updateContainerRef(workspaceId: string, containerRef: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE workspaces SET container_ref = ?, updated_at = ? WHERE id = ?
    `).run(containerRef, now, workspaceId);
  }

  clearContainerRef(workspaceId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE workspaces SET container_ref = NULL, updated_at = ? WHERE id = ?
    `).run(now, workspaceId);
  }

  touch(workspaceId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE workspaces SET updated_at = ? WHERE id = ?
    `).run(now, workspaceId);
  }

  updateBranchName(workspaceId: string, newBranchName: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE workspaces SET branch = ?, updated_at = ? WHERE id = ?
    `).run(newBranchName, now, workspaceId);
  }

  setArchived(workspaceId: string, archived: boolean): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE workspaces SET archived = ?, updated_at = ? WHERE id = ?
    `).run(archived ? 1 : 0, now, workspaceId);
  }

  update(workspaceId: string, data: UpdateWorkspace): void {
    const now = new Date().toISOString();

    // Build dynamic update
    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];

    if (data.archived !== undefined) {
      updates.push('archived = ?');
      params.push(data.archived ? 1 : 0);
    }
    if (data.pinned !== undefined) {
      updates.push('pinned = ?');
      params.push(data.pinned ? 1 : 0);
    }
    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name || null);
    }

    params.push(workspaceId);

    this.db.prepare(`
      UPDATE workspaces SET ${updates.join(', ')} WHERE id = ?
    `).run(...params);
  }

  delete(id: string): number {
    const result = this.db.prepare(
      'DELETE FROM workspaces WHERE id = ?'
    ).run(id);
    return result.changes;
  }
}
