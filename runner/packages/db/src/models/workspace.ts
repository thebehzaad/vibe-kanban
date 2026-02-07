/**
 * Workspace model
 * Translates: crates/db/src/models/workspace.rs
 */

import * as crypto from 'node:crypto';
import type { DBService } from '../connection.js';

const WORKSPACE_NAME_MAX_LEN = 60;

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

export interface CreateWorkspace {
  branch: string;
  agentWorkingDir?: string;
}

export interface UpdateWorkspace {
  archived?: boolean;
  pinned?: boolean;
  name?: string;
}

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

export class WorkspaceRepository {
  constructor(private db: DBService) {}

  /**
   * Truncate text to workspace name
   */
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

  /**
   * Count total workspaces
   */
  countAll(): number {
    const row = this.db.database.prepare(
      'SELECT COUNT(*) as count FROM workspaces'
    ).get() as { count: number };
    return row.count;
  }

  /**
   * Fetch all workspaces, optionally filtered by task_id
   */
  fetchAll(taskId?: string): Workspace[] {
    let rows: WorkspaceRow[];

    if (taskId) {
      rows = this.db.database.prepare(`
        SELECT id, task_id, container_ref, branch, agent_working_dir, setup_completed_at,
               archived, pinned, name, created_at, updated_at
        FROM workspaces
        WHERE task_id = ?
        ORDER BY created_at DESC
      `).all(taskId) as WorkspaceRow[];
    } else {
      rows = this.db.database.prepare(`
        SELECT id, task_id, container_ref, branch, agent_working_dir, setup_completed_at,
               archived, pinned, name, created_at, updated_at
        FROM workspaces
        ORDER BY created_at DESC
      `).all() as WorkspaceRow[];
    }

    return rows.map(rowToWorkspace);
  }

  /**
   * Find workspace by ID
   */
  findById(id: string): Workspace | undefined {
    const row = this.db.database.prepare(`
      SELECT id, task_id, container_ref, branch, agent_working_dir, setup_completed_at,
             archived, pinned, name, created_at, updated_at
      FROM workspaces
      WHERE id = ?
    `).get(id) as WorkspaceRow | undefined;

    return row ? rowToWorkspace(row) : undefined;
  }

  /**
   * Find workspace by ID with status
   */
  findByIdWithStatus(id: string): WorkspaceWithStatus | undefined {
    const row = this.db.database.prepare(`
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

    return {
      ...rowToWorkspace(row),
      isRunning: row.is_running !== 0,
      isErrored: row.is_errored !== 0
    };
  }

  /**
   * Find all workspaces with status
   */
  findAllWithStatus(archived?: boolean, limit?: number): WorkspaceWithStatus[] {
    const rows = this.db.database.prepare(`
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

    return result;
  }

  /**
   * Check if container ref exists
   */
  containerRefExists(containerRef: string): boolean {
    const row = this.db.database.prepare(`
      SELECT 1 FROM workspaces WHERE container_ref = ? LIMIT 1
    `).get(containerRef);
    return row !== undefined;
  }

  /**
   * Resolve container ref to workspace info
   */
  resolveContainerRef(containerRef: string): ContainerInfo | undefined {
    const row = this.db.database.prepare(`
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

  /**
   * Create a new workspace
   */
  create(data: CreateWorkspace, workspaceId: string, taskId: string): Workspace {
    const now = new Date().toISOString();

    this.db.database.prepare(`
      INSERT INTO workspaces (id, task_id, container_ref, branch, agent_working_dir, setup_completed_at, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, NULL, ?, ?)
    `).run(workspaceId, taskId, data.branch, data.agentWorkingDir ?? null, now, now);

    return this.findById(workspaceId)!;
  }

  /**
   * Update container reference
   */
  updateContainerRef(workspaceId: string, containerRef: string): void {
    const now = new Date().toISOString();
    this.db.database.prepare(`
      UPDATE workspaces SET container_ref = ?, updated_at = ? WHERE id = ?
    `).run(containerRef, now, workspaceId);
  }

  /**
   * Clear container reference
   */
  clearContainerRef(workspaceId: string): void {
    const now = new Date().toISOString();
    this.db.database.prepare(`
      UPDATE workspaces SET container_ref = NULL, updated_at = ? WHERE id = ?
    `).run(now, workspaceId);
  }

  /**
   * Touch workspace (update updated_at)
   */
  touch(workspaceId: string): void {
    const now = new Date().toISOString();
    this.db.database.prepare(`
      UPDATE workspaces SET updated_at = ? WHERE id = ?
    `).run(now, workspaceId);
  }

  /**
   * Update branch name
   */
  updateBranchName(workspaceId: string, newBranchName: string): void {
    const now = new Date().toISOString();
    this.db.database.prepare(`
      UPDATE workspaces SET branch = ?, updated_at = ? WHERE id = ?
    `).run(newBranchName, now, workspaceId);
  }

  /**
   * Set archived status
   */
  setArchived(workspaceId: string, archived: boolean): void {
    const now = new Date().toISOString();
    this.db.database.prepare(`
      UPDATE workspaces SET archived = ?, updated_at = ? WHERE id = ?
    `).run(archived ? 1 : 0, now, workspaceId);
  }

  /**
   * Update workspace fields
   */
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

    this.db.database.prepare(`
      UPDATE workspaces SET ${updates.join(', ')} WHERE id = ?
    `).run(...params);
  }

  /**
   * Delete a workspace
   */
  delete(id: string): number {
    const result = this.db.database.prepare(
      'DELETE FROM workspaces WHERE id = ?'
    ).run(id);
    return result.changes;
  }

  // ==================== Workspace Repos ====================

  /**
   * Create a workspace-repo link
   * Translates: WorkspaceRepo::create in Rust
   */
  createWorkspaceRepo(
    workspaceId: string,
    repoId: string,
    targetBranch: string,
    worktreePath?: string,
  ): void {
    const id = crypto.randomUUID();
    this.db.database.prepare(`
      INSERT INTO workspace_repos (id, workspace_id, repo_id, target_branch, worktree_path, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(id, workspaceId, repoId, targetBranch, worktreePath ?? null);
  }

  /**
   * Get workspace repos with joined repo info
   * Translates: WorkspaceRepo::find_by_workspace_id in Rust
   */
  getWorkspaceRepos(workspaceId: string): WorkspaceRepoInfo[] {
    return this.db.database.prepare(`
      SELECT wr.repo_id, wr.target_branch, wr.worktree_path,
             r.path as repo_path, r.name as repo_name
      FROM workspace_repos wr
      JOIN repos r ON wr.repo_id = r.id
      WHERE wr.workspace_id = ?
    `).all(workspaceId) as WorkspaceRepoInfo[];
  }

  /**
   * Update target branch for all workspace repos
   */
  updateTargetBranch(workspaceId: string, targetBranch: string): void {
    this.db.database.prepare(`
      UPDATE workspace_repos SET target_branch = ? WHERE workspace_id = ?
    `).run(targetBranch, workspaceId);
  }
}

export interface WorkspaceRepoInfo {
  repo_id: string;
  target_branch: string;
  worktree_path: string | null;
  repo_path: string;
  repo_name: string;
}
