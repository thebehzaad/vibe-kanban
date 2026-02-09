/**
 * Project service
 * Translates: crates/services/src/services/project.rs
 *
 * Project CRUD, repository management, and file search across repos.
 */

import type { DatabaseType } from '@runner/db';
import {
  ProjectRepository,
  ProjectRepoRepository,
  ProjectRepoError,
  RepoRepository,
  type Project,
  type CreateProject,
  type UpdateProject,
  type CreateProjectRepo,
  type Repo,
  type SearchResult,
  type SearchMatchType,
} from '@runner/db';

import { RepoError, RepoService } from './repo.js';

// ── Forward references (will be imported from file-search when translated) ──

export interface SearchQuery {
  q: string;
  mode?: SearchMode;
}

export type SearchMode = 'taskform' | 'settings';

export interface FileSearchCache {
  searchRepo(
    repoPath: string,
    query: string,
    mode: SearchMode | undefined,
  ): Promise<SearchResult[]>;
}

// ── Error ──

export type ProjectServiceErrorCode =
  | 'database'
  | 'io'
  | 'project'
  | 'path_not_found'
  | 'path_not_directory'
  | 'not_git_repository'
  | 'duplicate_git_repo_path'
  | 'duplicate_repository_name'
  | 'repository_not_found'
  | 'git'
  | 'remote_client';

export class ProjectServiceError extends Error {
  readonly code: ProjectServiceErrorCode;

  constructor(code: ProjectServiceErrorCode, message: string) {
    super(message);
    this.name = 'ProjectServiceError';
    this.code = code;
  }

  static database(err: Error): ProjectServiceError {
    return new ProjectServiceError('database', err.message);
  }

  static io(err: Error): ProjectServiceError {
    return new ProjectServiceError('io', err.message);
  }

  static project(msg: string): ProjectServiceError {
    return new ProjectServiceError('project', msg);
  }

  static pathNotFound(p: string): ProjectServiceError {
    return new ProjectServiceError('path_not_found', `Path does not exist: ${p}`);
  }

  static pathNotDirectory(p: string): ProjectServiceError {
    return new ProjectServiceError('path_not_directory', `Path is not a directory: ${p}`);
  }

  static notGitRepository(p: string): ProjectServiceError {
    return new ProjectServiceError('not_git_repository', `Path is not a git repository: ${p}`);
  }

  static duplicateGitRepoPath(): ProjectServiceError {
    return new ProjectServiceError('duplicate_git_repo_path', 'Duplicate git repository path');
  }

  static duplicateRepositoryName(): ProjectServiceError {
    return new ProjectServiceError('duplicate_repository_name', 'Duplicate repository name in project');
  }

  static repositoryNotFound(): ProjectServiceError {
    return new ProjectServiceError('repository_not_found', 'Repository not found');
  }

  static git(msg: string): ProjectServiceError {
    return new ProjectServiceError('git', `Git operation failed: ${msg}`);
  }

  static remoteClient(msg: string): ProjectServiceError {
    return new ProjectServiceError('remote_client', `Remote client error: ${msg}`);
  }

  /** Map a RepoError to a ProjectServiceError */
  static fromRepoError(e: RepoError): ProjectServiceError {
    switch (e.code) {
      case 'path_not_found':
        return ProjectServiceError.pathNotFound(e.message);
      case 'path_not_directory':
        return ProjectServiceError.pathNotDirectory(e.message);
      case 'not_git_repository':
        return ProjectServiceError.notGitRepository(e.message);
      case 'io':
        return ProjectServiceError.io(e);
      case 'database':
        return ProjectServiceError.database(e);
      default:
        return ProjectServiceError.repositoryNotFound();
    }
  }
}

// ── ProjectService ──

export class ProjectService {
  createProject(
    db: DatabaseType,
    repoService: RepoService,
    payload: CreateProject,
  ): Project {
    // Validate all repository paths and check for duplicates within the payload
    const seenNames = new Set<string>();
    const seenPaths = new Set<string>();
    const normalizedRepos: CreateProjectRepo[] = [];

    for (const repo of payload.repositories) {
      let normalizedPath: string;
      try {
        normalizedPath = repoService.normalizePath(repo.gitRepoPath);
      } catch (err) {
        if (err instanceof RepoError) {
          throw ProjectServiceError.fromRepoError(err);
        }
        throw err;
      }

      try {
        repoService.validateGitRepoPath(normalizedPath);
      } catch (err) {
        if (err instanceof RepoError) {
          throw ProjectServiceError.fromRepoError(err);
        }
        throw err;
      }

      if (seenNames.has(repo.displayName)) {
        throw ProjectServiceError.duplicateRepositoryName();
      }
      seenNames.add(repo.displayName);

      if (seenPaths.has(normalizedPath)) {
        throw ProjectServiceError.duplicateGitRepoPath();
      }
      seenPaths.add(normalizedPath);

      normalizedRepos.push({
        displayName: repo.displayName,
        gitRepoPath: normalizedPath,
      });
    }

    const projectRepo = new ProjectRepository(db);
    const repoRepo = new RepoRepository(db);
    const projectRepoRepo = new ProjectRepoRepository(db);

    const project = projectRepo.create(payload);

    for (const repo of normalizedRepos) {
      const repoEntity = repoRepo.findOrCreate(repo.gitRepoPath, repo.displayName);
      projectRepoRepo.create(project.id, repoEntity.id);
    }

    return project;
  }

  updateProject(
    db: DatabaseType,
    existing: Project,
    payload: UpdateProject,
  ): Project {
    const projectRepo = new ProjectRepository(db);
    const updated = projectRepo.update(existing.id, payload);
    if (!updated) {
      throw ProjectServiceError.project('Failed to update project');
    }
    return updated;
  }

  addRepository(
    db: DatabaseType,
    repoService: RepoService,
    projectId: string,
    payload: CreateProjectRepo,
  ): Repo {
    console.debug(
      `Adding repository '${payload.displayName}' to project ${projectId} (path: ${payload.gitRepoPath})`,
    );

    let normalizedPath: string;
    try {
      normalizedPath = repoService.normalizePath(payload.gitRepoPath);
    } catch (err) {
      if (err instanceof RepoError) {
        throw ProjectServiceError.fromRepoError(err);
      }
      throw err;
    }

    try {
      repoService.validateGitRepoPath(normalizedPath);
    } catch (err) {
      if (err instanceof RepoError) {
        throw ProjectServiceError.fromRepoError(err);
      }
      throw err;
    }

    const projectRepoRepo = new ProjectRepoRepository(db);

    let repository: Repo;
    try {
      repository = projectRepoRepo.addRepoToProject(
        projectId,
        normalizedPath,
        payload.displayName,
      );
    } catch (err) {
      if (err instanceof ProjectRepoError) {
        if (err.message.includes('already exists')) {
          throw ProjectServiceError.duplicateGitRepoPath();
        }
        throw ProjectServiceError.database(err);
      }
      throw err;
    }

    console.info(
      `Added repository ${repository.id} to project ${projectId} (path: ${repository.path})`,
    );

    return repository;
  }

  deleteRepository(
    db: DatabaseType,
    projectId: string,
    repoId: string,
  ): void {
    console.debug(
      `Removing repository ${repoId} from project ${projectId}`,
    );

    const projectRepoRepo = new ProjectRepoRepository(db);

    try {
      projectRepoRepo.removeRepoFromProject(projectId, repoId);
    } catch (err) {
      if (err instanceof ProjectRepoError) {
        throw ProjectServiceError.repositoryNotFound();
      }
      throw err;
    }

    const repoRepo = new RepoRepository(db);
    try {
      repoRepo.deleteOrphaned();
    } catch (err) {
      console.error(`Failed to delete orphaned repos: ${err}`);
    }

    console.info(`Removed repository ${repoId} from project ${projectId}`);
  }

  deleteProject(
    db: DatabaseType,
    projectId: string,
  ): number {
    const projectRepo = new ProjectRepository(db);
    const rowsAffected = projectRepo.delete(projectId);

    const repoRepo = new RepoRepository(db);
    try {
      repoRepo.deleteOrphaned();
    } catch (err) {
      console.error(`Failed to delete orphaned repos: ${err}`);
    }

    return rowsAffected;
  }

  getRepositories(
    db: DatabaseType,
    projectId: string,
  ): Repo[] {
    const projectRepoRepo = new ProjectRepoRepository(db);
    return projectRepoRepo.findReposForProject(projectId);
  }

  async searchFiles(
    cache: FileSearchCache,
    repositories: Repo[],
    query: SearchQuery,
  ): Promise<SearchResult[]> {
    const queryStr = query.q.trim();
    if (queryStr.length === 0 || repositories.length === 0) {
      return [];
    }

    // Search in parallel and prefix paths with repo name
    const searchPromises = repositories.map(async (repo) => {
      try {
        const results = await cache.searchRepo(repo.path, queryStr, query.mode);
        return { repoName: repo.name, results };
      } catch (err) {
        console.warn(`Search failed for repo ${repo.name}: ${err}`);
        return { repoName: repo.name, results: [] as SearchResult[] };
      }
    });

    const repoResults = await Promise.all(searchPromises);

    const allResults: SearchResult[] = repoResults.flatMap(({ repoName, results }) =>
      results.map((r) => ({
        path: `${repoName}/${r.path}`,
        isFile: r.isFile,
        matchType: r.matchType,
        score: r.score,
      })),
    );

    // Sort by match type priority, then by score descending
    const priority = (m: SearchMatchType): number => {
      switch (m) {
        case 'FileName': return 0;
        case 'DirectoryName': return 1;
        case 'FullPath': return 2;
        default: return 3;
      }
    };

    allResults.sort((a, b) => {
      const p = priority(a.matchType) - priority(b.matchType);
      if (p !== 0) return p;
      return b.score - a.score; // Higher scores first
    });

    // Limit to top 10
    return allResults.slice(0, 10);
  }
}
