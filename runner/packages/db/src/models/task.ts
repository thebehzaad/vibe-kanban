/**
 * Task model
 * Translates: crates/db/src/models/task.rs
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseType } from '../connection.js';
import type { Workspace } from './workspace.js';

// --- Types ---

export type TaskStatus = 'todo' | 'inprogress' | 'inreview' | 'done' | 'cancelled';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  parentWorkspaceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskWithAttemptStatus extends Task {
  hasInProgressAttempt: boolean;
  lastAttemptFailed: boolean;
  executor: string;
}

export interface TaskRelationships {
  parentTask?: Task;
  currentWorkspace: Workspace;
  children: Task[];
}

export interface CreateTask {
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  parentWorkspaceId?: string;
  imageIds?: string[];
}

export interface UpdateTask {
  title?: string;
  description?: string;
  status?: TaskStatus;
  parentWorkspaceId?: string;
  imageIds?: string[];
}

// --- Row mapping ---

interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  parent_workspace_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as TaskStatus,
    parentWorkspaceId: row.parent_workspace_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// --- Repository ---

export class TaskRepository {
  constructor(private db: DatabaseType) {}

  static toPrompt(task: Task): string {
    if (task.description && task.description.trim()) {
      return `${task.title}\n\n${task.description}`;
    }
    return task.title;
  }

  static fromTitleDescription(projectId: string, title: string, description?: string): CreateTask {
    return {
      projectId,
      title,
      description,
      status: 'todo',
      parentWorkspaceId: undefined,
      imageIds: undefined,
    };
  }

  findAll(): Task[] {
    const rows = this.db.prepare(`
      SELECT id, project_id, title, description, status, parent_workspace_id, created_at, updated_at
      FROM tasks
      ORDER BY created_at ASC
    `).all() as TaskRow[];

    return rows.map(rowToTask);
  }

  findByProjectIdWithAttemptStatus(projectId: string): TaskWithAttemptStatus[] {
    const rows = this.db.prepare(`
      SELECT
        t.id,
        t.project_id,
        t.title,
        t.description,
        t.status,
        t.parent_workspace_id,
        t.created_at,
        t.updated_at,
        CASE WHEN EXISTS (
          SELECT 1
          FROM workspaces w
          JOIN sessions s ON s.workspace_id = w.id
          JOIN execution_processes ep ON ep.session_id = s.id
          WHERE w.task_id = t.id
            AND ep.status = 'running'
            AND ep.run_reason IN ('setupscript','cleanupscript','codingagent')
          LIMIT 1
        ) THEN 1 ELSE 0 END as has_in_progress_attempt,
        CASE WHEN (
          SELECT ep.status
          FROM workspaces w
          JOIN sessions s ON s.workspace_id = w.id
          JOIN execution_processes ep ON ep.session_id = s.id
          WHERE w.task_id = t.id
            AND ep.run_reason IN ('setupscript','cleanupscript','codingagent')
          ORDER BY ep.created_at DESC
          LIMIT 1
        ) IN ('failed','killed') THEN 1 ELSE 0 END as last_attempt_failed,
        COALESCE(
          (SELECT s.executor
           FROM workspaces w
           JOIN sessions s ON s.workspace_id = w.id
           WHERE w.task_id = t.id
           ORDER BY s.created_at DESC
           LIMIT 1
          ), ''
        ) as executor
      FROM tasks t
      WHERE t.project_id = ?
      ORDER BY t.created_at DESC
    `).all(projectId) as (TaskRow & {
      has_in_progress_attempt: number;
      last_attempt_failed: number;
      executor: string;
    })[];

    return rows.map(row => ({
      ...rowToTask(row),
      hasInProgressAttempt: row.has_in_progress_attempt !== 0,
      lastAttemptFailed: row.last_attempt_failed !== 0,
      executor: row.executor
    }));
  }

  findById(id: string): Task | undefined {
    const row = this.db.prepare(`
      SELECT id, project_id, title, description, status, parent_workspace_id, created_at, updated_at
      FROM tasks
      WHERE id = ?
    `).get(id) as TaskRow | undefined;

    return row ? rowToTask(row) : undefined;
  }

  findByRowid(rowid: number): Task | undefined {
    const row = this.db.prepare(`
      SELECT id, project_id, title, description, status, parent_workspace_id, created_at, updated_at
      FROM tasks
      WHERE rowid = ?
    `).get(rowid) as TaskRow | undefined;

    return row ? rowToTask(row) : undefined;
  }

  findChildrenByWorkspaceId(workspaceId: string): Task[] {
    const rows = this.db.prepare(`
      SELECT id, project_id, title, description, status, parent_workspace_id, created_at, updated_at
      FROM tasks
      WHERE parent_workspace_id = ?
      ORDER BY created_at DESC
    `).all(workspaceId) as TaskRow[];

    return rows.map(rowToTask);
  }

  create(data: CreateTask, taskId?: string): Task {
    const id = taskId ?? randomUUID();
    const status = data.status ?? 'todo';
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO tasks (id, project_id, title, description, status, parent_workspace_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.projectId,
      data.title,
      data.description ?? null,
      status,
      data.parentWorkspaceId ?? null,
      now,
      now
    );

    return this.findById(id)!;
  }

  update(id: string, projectId: string, data: UpdateTask): Task | undefined {
    const existing = this.findById(id);
    if (!existing || existing.projectId !== projectId) return undefined;

    const title = data.title ?? existing.title;
    const description = data.description ?? existing.description;
    const status = data.status ?? existing.status;
    const parentWorkspaceId = data.parentWorkspaceId ?? existing.parentWorkspaceId;
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE tasks
      SET title = ?, description = ?, status = ?, parent_workspace_id = ?, updated_at = ?
      WHERE id = ? AND project_id = ?
    `).run(
      title,
      description ?? null,
      status,
      parentWorkspaceId ?? null,
      now,
      id,
      projectId
    );

    return this.findById(id);
  }

  updateStatus(id: string, status: TaskStatus): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?
    `).run(status, now, id);
  }

  updateParentWorkspaceId(taskId: string, parentWorkspaceId?: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE tasks SET parent_workspace_id = ?, updated_at = ? WHERE id = ?
    `).run(parentWorkspaceId ?? null, now, taskId);
  }

  nullifyChildrenByWorkspaceId(workspaceId: string): number {
    const result = this.db.prepare(`
      UPDATE tasks SET parent_workspace_id = NULL WHERE parent_workspace_id = ?
    `).run(workspaceId);
    return result.changes;
  }

  delete(id: string): number {
    const result = this.db.prepare(
      'DELETE FROM tasks WHERE id = ?'
    ).run(id);
    return result.changes;
  }

  findRelationshipsForWorkspace(workspace: Workspace): TaskRelationships {
    // 1. Get the current task (task that owns this workspace)
    const currentTask = this.findById(workspace.taskId);
    if (!currentTask) throw new Error('Task not found for workspace');

    // 2. Get parent task (if current task was created by another workspace)
    let parentTask: Task | undefined;
    if (currentTask.parentWorkspaceId) {
      const parentWsRow = this.db.prepare(`
        SELECT id, task_id, container_ref, branch, agent_working_dir, setup_completed_at,
               archived, pinned, name, created_at, updated_at
        FROM workspaces
        WHERE id = ?
      `).get(currentTask.parentWorkspaceId) as any | undefined;

      if (parentWsRow) {
        parentTask = this.findById(parentWsRow.task_id);
      }
    }

    // 3. Get children tasks (created from this workspace)
    const children = this.findChildrenByWorkspaceId(workspace.id);

    return {
      parentTask,
      currentWorkspace: workspace,
      children,
    };
  }
}
