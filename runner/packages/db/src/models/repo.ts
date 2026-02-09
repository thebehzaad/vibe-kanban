/**
 * Repo model
 * Translates: crates/db/src/models/repo.rs
 */

import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { DatabaseType } from '../connection.js';

// --- Error ---

export class RepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoError';
  }

  static notFound(): RepoError {
    return new RepoError('Repository not found');
  }
}

// --- Types ---

export interface Repo {
  id: string;
  path: string;
  name: string;
  displayName: string;
  setupScript?: string;
  cleanupScript?: string;
  archiveScript?: string;
  copyFiles?: string;
  parallelSetupScript: boolean;
  devServerScript?: string;
  defaultTargetBranch?: string;
  defaultWorkingDir?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateRepo {
  displayName?: string | null;
  setupScript?: string | null;
  cleanupScript?: string | null;
  archiveScript?: string | null;
  copyFiles?: string | null;
  parallelSetupScript?: boolean | null;
  devServerScript?: string | null;
  defaultTargetBranch?: string | null;
  defaultWorkingDir?: string | null;
}

// --- Row mapping ---

interface RepoRow {
  id: string;
  path: string;
  name: string;
  display_name: string;
  setup_script: string | null;
  cleanup_script: string | null;
  archive_script: string | null;
  copy_files: string | null;
  parallel_setup_script: number;
  dev_server_script: string | null;
  default_target_branch: string | null;
  default_working_dir: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToRepo(row: RepoRow): Repo {
  return {
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
    updatedAt: row.updated_at
  };
}

// --- Repository ---

export class RepoRepository {
  constructor(private db: DatabaseType) {}

  findById(id: string): Repo | undefined {
    const row = this.db.prepare(`
      SELECT id, path, name, display_name, setup_script, cleanup_script, archive_script,
             copy_files, parallel_setup_script, dev_server_script, default_target_branch,
             default_working_dir, created_at, updated_at
      FROM repos
      WHERE id = ?
    `).get(id) as RepoRow | undefined;

    return row ? rowToRepo(row) : undefined;
  }

  findByIds(ids: string[]): Repo[] {
    if (ids.length === 0) return [];

    const repos: Repo[] = [];
    for (const id of ids) {
      const repo = this.findById(id);
      if (repo) repos.push(repo);
    }
    return repos;
  }

  findByPath(repoPath: string): Repo | undefined {
    const row = this.db.prepare(`
      SELECT id, path, name, display_name, setup_script, cleanup_script, archive_script,
             copy_files, parallel_setup_script, dev_server_script, default_target_branch,
             default_working_dir, created_at, updated_at
      FROM repos
      WHERE path = ?
    `).get(repoPath) as RepoRow | undefined;

    return row ? rowToRepo(row) : undefined;
  }

  listAll(): Repo[] {
    const rows = this.db.prepare(`
      SELECT id, path, name, display_name, setup_script, cleanup_script, archive_script,
             copy_files, parallel_setup_script, dev_server_script, default_target_branch,
             default_working_dir, created_at, updated_at
      FROM repos
      ORDER BY display_name ASC
    `).all() as RepoRow[];

    return rows.map(rowToRepo);
  }

  listNeedingNameFix(): Repo[] {
    const rows = this.db.prepare(`
      SELECT id, path, name, display_name, setup_script, cleanup_script, archive_script,
             copy_files, parallel_setup_script, dev_server_script, default_target_branch,
             default_working_dir, created_at, updated_at
      FROM repos
      WHERE name = '__NEEDS_BACKFILL__'
    `).all() as RepoRow[];

    return rows.map(rowToRepo);
  }

  findOrCreate(repoPath: string, displayName: string): Repo {
    const existing = this.findByPath(repoPath);
    if (existing) return existing;

    const id = randomUUID();
    const name = path.basename(repoPath) || id;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO repos (id, path, name, display_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET updated_at = updated_at
    `).run(id, repoPath, name, displayName, now, now);

    return this.findByPath(repoPath)!;
  }

  updateName(id: string, name: string, displayName: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE repos SET name = ?, display_name = ?, updated_at = ? WHERE id = ?
    `).run(name, displayName, now, id);
  }

  update(id: string, payload: UpdateRepo): Repo | undefined {
    const existing = this.findById(id);
    if (!existing) return undefined;

    const displayName = payload.displayName !== undefined
      ? (payload.displayName ?? '')
      : existing.displayName;
    const setupScript = payload.setupScript !== undefined
      ? payload.setupScript
      : existing.setupScript;
    const cleanupScript = payload.cleanupScript !== undefined
      ? payload.cleanupScript
      : existing.cleanupScript;
    const archiveScript = payload.archiveScript !== undefined
      ? payload.archiveScript
      : existing.archiveScript;
    const copyFiles = payload.copyFiles !== undefined
      ? payload.copyFiles
      : existing.copyFiles;
    const parallelSetupScript = payload.parallelSetupScript !== undefined
      ? (payload.parallelSetupScript ?? false)
      : existing.parallelSetupScript;
    const devServerScript = payload.devServerScript !== undefined
      ? payload.devServerScript
      : existing.devServerScript;
    const defaultTargetBranch = payload.defaultTargetBranch !== undefined
      ? payload.defaultTargetBranch
      : existing.defaultTargetBranch;
    const defaultWorkingDir = payload.defaultWorkingDir !== undefined
      ? payload.defaultWorkingDir
      : existing.defaultWorkingDir;

    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE repos SET
        display_name = ?,
        setup_script = ?,
        cleanup_script = ?,
        archive_script = ?,
        copy_files = ?,
        parallel_setup_script = ?,
        dev_server_script = ?,
        default_target_branch = ?,
        default_working_dir = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      displayName,
      setupScript ?? null,
      cleanupScript ?? null,
      archiveScript ?? null,
      copyFiles ?? null,
      parallelSetupScript ? 1 : 0,
      devServerScript ?? null,
      defaultTargetBranch ?? null,
      defaultWorkingDir ?? null,
      now,
      id
    );

    return this.findById(id);
  }

  deleteOrphaned(): number {
    const result = this.db.prepare(`
      DELETE FROM repos
      WHERE id NOT IN (SELECT repo_id FROM project_repos)
        AND id NOT IN (SELECT repo_id FROM workspace_repos)
    `).run();
    return result.changes;
  }
}
