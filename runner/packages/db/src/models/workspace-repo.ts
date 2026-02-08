/**
 * Workspace repo model
 * Translates: crates/db/src/models/workspace_repo.rs
 */

import type { DatabaseType } from '../connection.js';
import type { Repo } from './repo.js';
import { randomUUID } from 'node:crypto';
import { rowToRepo } from './repo.js';

// --- Types ---

export interface WorkspaceRepo {
  id: string;
  workspaceId: string;
  repoId: string;
  targetBranch: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceRepo {
  repoId: string;
  targetBranch: string;
}

export interface RepoWithTargetBranch extends Repo {
  targetBranch: string;
}

export interface RepoWithCopyFiles {
  id: string;
  path: string;
  name: string;
  copyFiles?: string;
}

// --- Row mapping ---

function rowToWorkspaceRepo(row: any): WorkspaceRepo {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    repoId: row.repo_id,
    targetBranch: row.target_branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Repository ---

export class WorkspaceRepoRepository {
  constructor(private db: DatabaseType) {}

  createMany(workspaceId: string, repos: CreateWorkspaceRepo[]): WorkspaceRepo[] {
    if (repos.length === 0) return [];

    const results: WorkspaceRepo[] = [];
    const stmt = this.db.prepare(
      `INSERT INTO workspace_repos (id, workspace_id, repo_id, target_branch)
       VALUES (?, ?, ?, ?)
       RETURNING *`,
    );

    const insertMany = this.db.transaction((items: CreateWorkspaceRepo[]) => {
      for (const repo of items) {
        const row = stmt.get(randomUUID(), workspaceId, repo.repoId, repo.targetBranch) as any;
        results.push(rowToWorkspaceRepo(row));
      }
    });

    insertMany(repos);
    return results;
  }

  findByWorkspaceId(workspaceId: string): WorkspaceRepo[] {
    const rows = this.db
      .prepare('SELECT * FROM workspace_repos WHERE workspace_id = ?')
      .all(workspaceId) as any[];
    return rows.map(rowToWorkspaceRepo);
  }

  findReposForWorkspace(workspaceId: string): Repo[] {
    const rows = this.db
      .prepare(
        `SELECT r.* FROM repos r
         JOIN workspace_repos wr ON r.id = wr.repo_id
         WHERE wr.workspace_id = ?
         ORDER BY r.display_name ASC`,
      )
      .all(workspaceId) as any[];
    return rows.map(rowToRepo);
  }

  findReposWithTargetBranchForWorkspace(workspaceId: string): RepoWithTargetBranch[] {
    const rows = this.db
      .prepare(
        `SELECT r.*, wr.target_branch
         FROM repos r
         JOIN workspace_repos wr ON r.id = wr.repo_id
         WHERE wr.workspace_id = ?
         ORDER BY r.display_name ASC`,
      )
      .all(workspaceId) as any[];

    return rows.map((row: any) => ({
      ...rowToRepo(row),
      targetBranch: row.target_branch,
    }));
  }

  findByWorkspaceAndRepoId(workspaceId: string, repoId: string): WorkspaceRepo | undefined {
    const row = this.db
      .prepare('SELECT * FROM workspace_repos WHERE workspace_id = ? AND repo_id = ?')
      .get(workspaceId, repoId) as any;
    return row ? rowToWorkspaceRepo(row) : undefined;
  }

  updateTargetBranch(workspaceId: string, repoId: string, newTargetBranch: string): void {
    this.db
      .prepare(
        "UPDATE workspace_repos SET target_branch = ?, updated_at = datetime('now') WHERE workspace_id = ? AND repo_id = ?",
      )
      .run(newTargetBranch, workspaceId, repoId);
  }

  updateTargetBranchForChildrenOfWorkspace(
    parentWorkspaceId: string,
    oldBranch: string,
    newBranch: string,
  ): number {
    const result = this.db
      .prepare(
        `UPDATE workspace_repos
         SET target_branch = ?, updated_at = datetime('now')
         WHERE target_branch = ?
           AND workspace_id IN (
             SELECT w.id FROM workspaces w
             JOIN tasks t ON w.task_id = t.id
             WHERE t.parent_workspace_id = ?
           )`,
      )
      .run(newBranch, oldBranch, parentWorkspaceId);
    return result.changes;
  }

  findUniqueReposForTask(taskId: string): Repo[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT r.*
         FROM repos r
         JOIN workspace_repos wr ON r.id = wr.repo_id
         JOIN workspaces w ON wr.workspace_id = w.id
         WHERE w.task_id = ?
         ORDER BY r.display_name ASC`,
      )
      .all(taskId) as any[];
    return rows.map(rowToRepo);
  }

  findReposWithCopyFiles(workspaceId: string): RepoWithCopyFiles[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.path, r.name, r.copy_files
         FROM repos r
         JOIN workspace_repos wr ON r.id = wr.repo_id
         WHERE wr.workspace_id = ?`,
      )
      .all(workspaceId) as any[];

    return rows.map((row: any) => ({
      id: row.id,
      path: row.path,
      name: row.name,
      copyFiles: row.copy_files ?? undefined,
    }));
  }
}
