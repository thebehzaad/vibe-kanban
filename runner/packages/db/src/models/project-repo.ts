/**
 * Project repo model
 * Translates: crates/db/src/models/project_repo.rs
 */

import type { DatabaseType } from '../connection.js';
import type { Repo } from './repo.js';
import { randomUUID } from 'node:crypto';
import { rowToRepo } from './repo.js';

// --- Types ---

export interface ProjectRepo {
  id: string;
  projectId: string;
  repoId: string;
}

export interface CreateProjectRepo {
  displayName: string;
  gitRepoPath: string;
}

// --- Error ---

export class ProjectRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectRepoError';
  }

  static notFound(): ProjectRepoError {
    return new ProjectRepoError('Repository not found');
  }

  static alreadyExists(): ProjectRepoError {
    return new ProjectRepoError('Repository already exists in this project');
  }
}

// --- Row mapping ---

function rowToProjectRepo(row: any): ProjectRepo {
  return {
    id: row.id,
    projectId: row.project_id,
    repoId: row.repo_id,
  };
}

// --- Repository ---

export class ProjectRepoRepository {
  constructor(private db: DatabaseType) {}

  findByProjectId(projectId: string): ProjectRepo[] {
    const rows = this.db
      .prepare(
        'SELECT id, project_id, repo_id FROM project_repos WHERE project_id = ?',
      )
      .all(projectId) as any[];
    return rows.map(rowToProjectRepo);
  }

  findByRepoId(repoId: string): ProjectRepo[] {
    const rows = this.db
      .prepare('SELECT id, project_id, repo_id FROM project_repos WHERE repo_id = ?')
      .all(repoId) as any[];
    return rows.map(rowToProjectRepo);
  }

  findReposForProject(projectId: string): Repo[] {
    const rows = this.db
      .prepare(
        `SELECT r.* FROM repos r
         JOIN project_repos pr ON r.id = pr.repo_id
         WHERE pr.project_id = ?
         ORDER BY r.display_name ASC`,
      )
      .all(projectId) as any[];
    return rows.map(rowToRepo);
  }

  findByProjectAndRepo(projectId: string, repoId: string): ProjectRepo | undefined {
    const row = this.db
      .prepare(
        'SELECT id, project_id, repo_id FROM project_repos WHERE project_id = ? AND repo_id = ?',
      )
      .get(projectId, repoId) as any;
    return row ? rowToProjectRepo(row) : undefined;
  }

  addRepoToProject(projectId: string, repoPath: string, repoName: string): Repo {
    // Find or create repo
    let repoRow = this.db.prepare('SELECT * FROM repos WHERE path = ?').get(repoPath) as any;
    if (!repoRow) {
      const repoId = randomUUID();
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO repos (id, path, name, display_name, parallel_setup_script, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(repoId, repoPath, repoName, repoName, now, now);
      repoRow = this.db.prepare('SELECT * FROM repos WHERE id = ?').get(repoId) as any;
    }

    const repo = rowToRepo(repoRow);

    // Check if already associated
    const existing = this.findByProjectAndRepo(projectId, repo.id);
    if (existing) {
      throw ProjectRepoError.alreadyExists();
    }

    const id = randomUUID();
    this.db
      .prepare('INSERT INTO project_repos (id, project_id, repo_id) VALUES (?, ?, ?)')
      .run(id, projectId, repo.id);

    return repo;
  }

  removeRepoFromProject(projectId: string, repoId: string): void {
    const result = this.db
      .prepare('DELETE FROM project_repos WHERE project_id = ? AND repo_id = ?')
      .run(projectId, repoId);

    if (result.changes === 0) {
      throw ProjectRepoError.notFound();
    }
  }

  create(projectId: string, repoId: string): ProjectRepo {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO project_repos (id, project_id, repo_id) VALUES (?, ?, ?)')
      .run(id, projectId, repoId);

    return { id, projectId, repoId };
  }
}
