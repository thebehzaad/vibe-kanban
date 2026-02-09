/**
 * Project model
 * Translates: crates/db/src/models/project.rs
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseType } from '../connection.js';
import type { CreateProjectRepo } from './project-repo.js';

// --- Error ---

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }

  static notFound(): ProjectError {
    return new ProjectError('Project not found');
  }

  static createFailed(reason: string): ProjectError {
    return new ProjectError(`Failed to create project: ${reason}`);
  }
}

// --- Types ---

export interface Project {
  id: string;
  name: string;
  defaultAgentWorkingDir?: string;
  remoteProjectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProject {
  name: string;
  repositories: CreateProjectRepo[];
}

export interface UpdateProject {
  name?: string;
}

export interface SearchResult {
  path: string;
  isFile: boolean;
  matchType: SearchMatchType;
  score: number;
}

export type SearchMatchType = 'FileName' | 'DirectoryName' | 'FullPath';

// --- Row mapping ---

interface ProjectRow {
  id: string;
  name: string;
  default_agent_working_dir: string | null;
  remote_project_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    defaultAgentWorkingDir: row.default_agent_working_dir ?? undefined,
    remoteProjectId: row.remote_project_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// --- Repository ---

export class ProjectRepository {
  constructor(private db: DatabaseType) {}

  count(): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM projects'
    ).get() as { count: number };
    return row.count;
  }

  findAll(): Project[] {
    const rows = this.db.prepare(`
      SELECT id, name, default_agent_working_dir, remote_project_id, created_at, updated_at
      FROM projects
      ORDER BY created_at DESC
    `).all() as ProjectRow[];

    return rows.map(rowToProject);
  }

  findMostActive(limit: number): Project[] {
    const rows = this.db.prepare(`
      SELECT p.id, p.name, p.default_agent_working_dir, p.remote_project_id, p.created_at, p.updated_at
      FROM projects p
      WHERE p.id IN (
        SELECT DISTINCT t.project_id
        FROM tasks t
        INNER JOIN workspaces w ON w.task_id = t.id
        ORDER BY w.updated_at DESC
      )
      LIMIT ?
    `).all(limit) as ProjectRow[];

    return rows.map(rowToProject);
  }

  findById(id: string): Project | undefined {
    const row = this.db.prepare(`
      SELECT id, name, default_agent_working_dir, remote_project_id, created_at, updated_at
      FROM projects
      WHERE id = ?
    `).get(id) as ProjectRow | undefined;

    return row ? rowToProject(row) : undefined;
  }

  findByRowid(rowid: number): Project | undefined {
    const row = this.db.prepare(`
      SELECT id, name, default_agent_working_dir, remote_project_id, created_at, updated_at
      FROM projects
      WHERE rowid = ?
    `).get(rowid) as ProjectRow | undefined;

    return row ? rowToProject(row) : undefined;
  }

  findByRemoteProjectId(remoteProjectId: string): Project | undefined {
    const row = this.db.prepare(`
      SELECT id, name, default_agent_working_dir, remote_project_id, created_at, updated_at
      FROM projects
      WHERE remote_project_id = ?
      LIMIT 1
    `).get(remoteProjectId) as ProjectRow | undefined;

    return row ? rowToProject(row) : undefined;
  }

  create(data: CreateProject, projectId?: string): Project {
    const id = projectId ?? randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO projects (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(id, data.name, now, now);

    return this.findById(id)!;
  }

  update(id: string, payload: UpdateProject): Project | undefined {
    const existing = this.findById(id);
    if (!existing) return undefined;

    const name = payload.name ?? existing.name;
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE projects
      SET name = ?, updated_at = ?
      WHERE id = ?
    `).run(name, now, id);

    return this.findById(id);
  }

  setRemoteProjectId(id: string, remoteProjectId?: string): void {
    this.db.prepare(`
      UPDATE projects
      SET remote_project_id = ?
      WHERE id = ?
    `).run(remoteProjectId ?? null, id);
  }

  delete(id: string): number {
    const result = this.db.prepare(
      'DELETE FROM projects WHERE id = ?'
    ).run(id);
    return result.changes;
  }
}
