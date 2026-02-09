/**
 * Repository service
 * Translates: crates/services/src/services/repo.rs
 *
 * Repository registration, path validation, and git init.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { DatabaseType } from '@runner/db';
import { RepoRepository, type Repo } from '@runner/db';
import { GitService, type GitServiceError } from '@runner/git';
import { expandTilde } from '@runner/utils';

// ── Error ──

export type RepoErrorCode =
  | 'database'
  | 'io'
  | 'path_not_found'
  | 'path_not_directory'
  | 'not_git_repository'
  | 'not_found'
  | 'directory_already_exists'
  | 'git'
  | 'invalid_folder_name';

export class RepoError extends Error {
  readonly code: RepoErrorCode;

  constructor(code: RepoErrorCode, message: string) {
    super(message);
    this.name = 'RepoError';
    this.code = code;
  }

  static database(err: Error): RepoError {
    return new RepoError('database', err.message);
  }

  static io(err: Error): RepoError {
    return new RepoError('io', err.message);
  }

  static pathNotFound(p: string): RepoError {
    return new RepoError('path_not_found', `Path does not exist: ${p}`);
  }

  static pathNotDirectory(p: string): RepoError {
    return new RepoError('path_not_directory', `Path is not a directory: ${p}`);
  }

  static notGitRepository(p: string): RepoError {
    return new RepoError('not_git_repository', `Path is not a git repository: ${p}`);
  }

  static notFound(): RepoError {
    return new RepoError('not_found', 'Repository not found');
  }

  static directoryAlreadyExists(p: string): RepoError {
    return new RepoError('directory_already_exists', `Directory already exists: ${p}`);
  }

  static git(err: GitServiceError): RepoError {
    return new RepoError('git', `Git error: ${err.message}`);
  }

  static invalidFolderName(name: string): RepoError {
    return new RepoError('invalid_folder_name', `Invalid folder name: ${name}`);
  }
}

// ── RepoService ──

export class RepoService {
  validateGitRepoPath(repoPath: string): void {
    if (!fs.existsSync(repoPath)) {
      throw RepoError.pathNotFound(repoPath);
    }

    const stat = fs.statSync(repoPath);
    if (!stat.isDirectory()) {
      throw RepoError.pathNotDirectory(repoPath);
    }

    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      throw RepoError.notGitRepository(repoPath);
    }
  }

  normalizePath(p: string): string {
    return path.resolve(expandTilde(p));
  }

  register(
    db: DatabaseType,
    repoPath: string,
    displayName?: string,
  ): Repo {
    const normalizedPath = this.normalizePath(repoPath);
    this.validateGitRepoPath(normalizedPath);

    const name = path.basename(normalizedPath) || 'unnamed';
    const finalDisplayName = displayName ?? name;

    const repoRepo = new RepoRepository(db);
    return repoRepo.findOrCreate(normalizedPath, finalDisplayName);
  }

  findById(db: DatabaseType, repoId: string): Repo | undefined {
    const repoRepo = new RepoRepository(db);
    return repoRepo.findById(repoId);
  }

  getById(db: DatabaseType, repoId: string): Repo {
    const repo = this.findById(db, repoId);
    if (!repo) {
      throw RepoError.notFound();
    }
    return repo;
  }

  initRepo(
    db: DatabaseType,
    git: GitService,
    parentPath: string,
    folderName: string,
  ): Repo {
    if (
      !folderName ||
      folderName.includes('/') ||
      folderName.includes('\\') ||
      folderName === '.' ||
      folderName === '..'
    ) {
      throw RepoError.invalidFolderName(folderName);
    }

    const normalizedParent = this.normalizePath(parentPath);
    if (!fs.existsSync(normalizedParent)) {
      throw RepoError.pathNotFound(normalizedParent);
    }

    const stat = fs.statSync(normalizedParent);
    if (!stat.isDirectory()) {
      throw RepoError.pathNotDirectory(normalizedParent);
    }

    const repoPath = path.join(normalizedParent, folderName);
    if (fs.existsSync(repoPath)) {
      throw RepoError.directoryAlreadyExists(repoPath);
    }

    try {
      git.initializeRepoWithMainBranch(repoPath);
    } catch (err) {
      throw RepoError.git(err as GitServiceError);
    }

    const repoRepo = new RepoRepository(db);
    return repoRepo.findOrCreate(repoPath, folderName);
  }
}
