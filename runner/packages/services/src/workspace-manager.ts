/**
 * Workspace manager service
 * Translates: crates/services/src/services/workspace_manager.rs
 *
 * Manages workspace creation with worktrees for all project repositories.
 * Handles rollback on partial failures, legacy migration, and orphan cleanup.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { DatabaseType } from '@runner/db';
import { WorkspaceRepository, type Repo } from '@runner/db';

import {
  WorktreeManager,
  createWorktreeCleanup,
  type WorktreeCleanup,
  WorktreeError,
} from './worktree-manager.js';

// ── Types ──

export interface RepoWorkspaceInput {
  repo: Repo;
  targetBranch: string;
}

export function createRepoWorkspaceInput(repo: Repo, targetBranch: string): RepoWorkspaceInput {
  return { repo, targetBranch };
}

// ── Error ──

export type WorkspaceErrorCode =
  | 'worktree'
  | 'io'
  | 'no_repositories'
  | 'partial_creation';

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;

  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
  }

  static fromWorktree(err: WorktreeError): WorkspaceError {
    return new WorkspaceError('worktree', err.message);
  }

  static io(err: Error): WorkspaceError {
    return new WorkspaceError('io', `IO error: ${err.message}`);
  }

  static noRepositories(): WorkspaceError {
    return new WorkspaceError('no_repositories', 'No repositories provided');
  }

  static partialCreation(msg: string): WorkspaceError {
    return new WorkspaceError('partial_creation', `Partial workspace creation failed: ${msg}`);
  }
}

// ── Result types ──

/** Info about a single repo's worktree within a workspace */
export interface RepoWorktree {
  repoId: string;
  repoName: string;
  sourceRepoPath: string;
  worktreePath: string;
}

/** A container directory holding worktrees for all project repos */
export interface WorktreeContainer {
  workspaceDir: string;
  worktrees: RepoWorktree[];
}

// ── WorkspaceManager ──

export class WorkspaceManager {
  /**
   * Create a workspace with worktrees for all repositories.
   * On failure, rolls back any already-created worktrees.
   */
  static async createWorkspace(
    workspaceDir: string,
    repos: RepoWorkspaceInput[],
    branchName: string,
  ): Promise<WorktreeContainer> {
    if (repos.length === 0) {
      throw WorkspaceError.noRepositories();
    }

    console.log(
      `Creating workspace at ${workspaceDir} with ${repos.length} repositories`,
    );

    try {
      await fsp.mkdir(workspaceDir, { recursive: true });
    } catch (err) {
      throw WorkspaceError.io(err as Error);
    }

    const createdWorktrees: RepoWorktree[] = [];

    for (const input of repos) {
      const worktreePath = path.join(workspaceDir, input.repo.name);

      console.debug(
        `Creating worktree for repo '${input.repo.name}' at ${worktreePath}`,
      );

      try {
        await WorktreeManager.createWorktree(
          input.repo.path,
          branchName,
          worktreePath,
          input.targetBranch,
          true,
        );

        createdWorktrees.push({
          repoId: input.repo.id,
          repoName: input.repo.name,
          sourceRepoPath: input.repo.path,
          worktreePath,
        });
      } catch (err) {
        console.error(
          `Failed to create worktree for repo '${input.repo.name}': ${err}. Rolling back...`,
        );

        // Rollback: cleanup all worktrees we've created so far
        await WorkspaceManager.cleanupCreatedWorktrees(createdWorktrees);

        // Also remove the workspace directory if it's empty
        try {
          await fsp.rmdir(workspaceDir);
        } catch (cleanupErr) {
          console.debug(
            `Could not remove workspace dir during rollback: ${cleanupErr}`,
          );
        }

        throw WorkspaceError.partialCreation(
          `Failed to create worktree for repo '${input.repo.name}': ${err}`,
        );
      }
    }

    console.log(
      `Successfully created workspace with ${createdWorktrees.length} worktrees`,
    );

    return {
      workspaceDir,
      worktrees: createdWorktrees,
    };
  }

  /**
   * Ensure all worktrees in a workspace exist (for cold restart scenarios)
   */
  static async ensureWorkspaceExists(
    workspaceDir: string,
    repos: Repo[],
    branchName: string,
  ): Promise<void> {
    if (repos.length === 0) {
      throw WorkspaceError.noRepositories();
    }

    // Try legacy migration first (single repo projects only)
    // Old layout had worktree directly at workspace_dir; new layout has it at workspace_dir/{repo_name}
    if (repos.length === 1) {
      const migrated = await WorkspaceManager.migrateLegacyWorktree(
        workspaceDir,
        repos[0]!,
      );
      if (migrated) {
        return;
      }
    }

    if (!fs.existsSync(workspaceDir)) {
      try {
        await fsp.mkdir(workspaceDir, { recursive: true });
      } catch (err) {
        throw WorkspaceError.io(err as Error);
      }
    }

    for (const repo of repos) {
      const worktreePath = path.join(workspaceDir, repo.name);

      console.debug(
        `Ensuring worktree exists for repo '${repo.name}' at ${worktreePath}`,
      );

      try {
        await WorktreeManager.ensureWorktreeExists(
          repo.path,
          branchName,
          worktreePath,
        );
      } catch (err) {
        if (err instanceof WorktreeError) {
          throw WorkspaceError.fromWorktree(err);
        }
        throw err;
      }
    }
  }

  /**
   * Clean up all worktrees in a workspace
   */
  static async cleanupWorkspace(
    workspaceDir: string,
    repos: Repo[],
  ): Promise<void> {
    console.log(`Cleaning up workspace at ${workspaceDir}`);

    const cleanupData: WorktreeCleanup[] = repos.map((repo) => {
      const worktreePath = path.join(workspaceDir, repo.name);
      return createWorktreeCleanup(worktreePath, repo.path);
    });

    try {
      await WorktreeManager.batchCleanupWorktrees(cleanupData);
    } catch (err) {
      if (err instanceof WorktreeError) {
        throw WorkspaceError.fromWorktree(err);
      }
      throw err;
    }

    // Remove the workspace directory itself
    if (fs.existsSync(workspaceDir)) {
      try {
        await fsp.rm(workspaceDir, { recursive: true, force: true });
      } catch (e) {
        console.debug(
          `Could not remove workspace directory ${workspaceDir}: ${e}`,
        );
      }
    }
  }

  /** Get the base directory for workspaces (same as worktree base dir) */
  static getWorkspaceBaseDir(): string {
    return WorktreeManager.getWorktreeBaseDir();
  }

  /**
   * Migrate a legacy single-worktree layout to the new workspace layout.
   * Old layout: workspace_dir IS the worktree
   * New layout: workspace_dir contains worktrees at workspace_dir/{repo_name}
   *
   * Returns true if migration was performed, false if no migration needed.
   */
  static async migrateLegacyWorktree(
    workspaceDir: string,
    repo: Repo,
  ): Promise<boolean> {
    const expectedWorktreePath = path.join(workspaceDir, repo.name);

    // Detect old-style: workspace_dir exists AND has .git file (worktree marker)
    // AND expected new location doesn't exist
    const gitFile = path.join(workspaceDir, '.git');
    const isOldStyle =
      fs.existsSync(workspaceDir) &&
      fs.existsSync(gitFile) &&
      fs.statSync(gitFile).isFile() && // .git file = worktree, .git dir = main repo
      !fs.existsSync(expectedWorktreePath);

    if (!isOldStyle) {
      return false;
    }

    console.log(
      `Detected legacy worktree at ${workspaceDir}, migrating to new layout`,
    );

    // Move old worktree to temp location (can't move into subdirectory of itself)
    const dirName = path.basename(workspaceDir) || '';
    const tempName = `${dirName}-migrating`;
    const tempPath = path.join(path.dirname(workspaceDir), tempName);

    await WorktreeManager.moveWorktree(repo.path, workspaceDir, tempPath);

    // Create new workspace directory
    await fsp.mkdir(workspaceDir, { recursive: true });

    // Move worktree to final location using git worktree move
    await WorktreeManager.moveWorktree(repo.path, tempPath, expectedWorktreePath);

    if (fs.existsSync(tempPath)) {
      try {
        await fsp.rm(tempPath, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }

    console.log(
      `Successfully migrated legacy worktree to ${expectedWorktreePath}`,
    );

    return true;
  }

  /** Helper to cleanup worktrees during rollback */
  private static async cleanupCreatedWorktrees(
    worktrees: RepoWorktree[],
  ): Promise<void> {
    for (const worktree of worktrees) {
      const cleanup = createWorktreeCleanup(
        worktree.worktreePath,
        worktree.sourceRepoPath,
      );

      try {
        await WorktreeManager.cleanupWorktree(cleanup);
      } catch (e) {
        console.error(
          `Failed to cleanup worktree '${worktree.repoName}' during rollback: ${e}`,
        );
      }
    }
  }

  static async cleanupOrphanWorkspaces(db: DatabaseType): Promise<void> {
    if (process.env.DISABLE_WORKTREE_CLEANUP) {
      console.log(
        'Orphan workspace cleanup is disabled via DISABLE_WORKTREE_CLEANUP environment variable',
      );
      return;
    }

    // Always clean up the default directory
    const defaultDir = WorktreeManager.getDefaultWorktreeBaseDir();
    await WorkspaceManager.cleanupOrphansInDirectory(db, defaultDir);

    // Also clean up custom directory if it's different from the default
    const currentDir = WorkspaceManager.getWorkspaceBaseDir();
    if (currentDir !== defaultDir) {
      await WorkspaceManager.cleanupOrphansInDirectory(db, currentDir);
    }
  }

  private static async cleanupOrphansInDirectory(
    db: DatabaseType,
    workspaceBaseDir: string,
  ): Promise<void> {
    if (!fs.existsSync(workspaceBaseDir)) {
      console.debug(
        `Workspace base directory ${workspaceBaseDir} does not exist, skipping orphan cleanup`,
      );
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(workspaceBaseDir, { withFileTypes: true });
    } catch (e) {
      console.error(
        `Failed to read workspace base directory ${workspaceBaseDir}: ${e}`,
      );
      return;
    }

    const wsRepo = new WorkspaceRepository(db);

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const entryPath = path.join(workspaceBaseDir, entry.name);

      if (!wsRepo.containerRefExists(entryPath)) {
        console.log(`Found orphaned workspace: ${entryPath}`);
        try {
          await WorkspaceManager.cleanupWorkspaceWithoutRepos(entryPath);
          console.log(
            `Successfully removed orphaned workspace: ${entryPath}`,
          );
        } catch (e) {
          console.error(
            `Failed to remove orphaned workspace ${entryPath}: ${e}`,
          );
        }
      }
    }
  }

  private static async cleanupWorkspaceWithoutRepos(
    workspaceDir: string,
  ): Promise<void> {
    console.log(`Cleaning up orphaned workspace at ${workspaceDir}`);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(workspaceDir, { withFileTypes: true });
    } catch (e) {
      console.debug(
        `Cannot read workspace directory ${workspaceDir}, attempting direct removal: ${e}`,
      );
      try {
        await fsp.rm(workspaceDir, { recursive: true, force: true });
      } catch (err) {
        throw WorkspaceError.io(err as Error);
      }
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const entryPath = path.join(workspaceDir, entry.name);
      try {
        await WorktreeManager.cleanupSuspectedWorktree(entryPath);
      } catch (e) {
        console.warn(`Failed to cleanup suspected worktree: ${e}`);
      }
    }

    if (fs.existsSync(workspaceDir)) {
      try {
        await fsp.rm(workspaceDir, { recursive: true, force: true });
      } catch (e) {
        console.debug(
          `Could not remove workspace directory ${workspaceDir}: ${e}`,
        );
      }
    }
  }
}
