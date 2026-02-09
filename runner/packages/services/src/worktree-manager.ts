/**
 * Worktree manager service
 * Translates: crates/services/src/services/worktree_manager.rs
 *
 * Manages git worktrees for parallel task isolation.
 * Each task gets its own git worktree on a unique branch.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { type GitService } from '@runner/git';
import {
  getVibeKanbanTempDir,
  normalizeMacosPrivateAlias,
  resolveExecutablePath,
  runCommand,
} from '@runner/utils';

// Global synchronization for worktree creation to prevent race conditions
const worktreeCreationLocks = new Map<string, Promise<void>>();

let workspaceDirOverride: string | undefined;

export interface WorktreeCleanup {
  worktreePath: string;
  gitRepoPath?: string;
}

export function createWorktreeCleanup(
  worktreePath: string,
  gitRepoPath?: string
): WorktreeCleanup {
  return { worktreePath, gitRepoPath };
}

export class WorktreeError extends Error {
  constructor(
    message: string,
    public code:
      | 'git'
      | 'git_cli'
      | 'invalid_path'
      | 'io'
      | 'branch_not_found'
      | 'repository' = 'git'
  ) {
    super(message);
    this.name = 'WorktreeError';
  }
}

export class WorktreeManager {
  static setWorkspaceDirOverride(p: string): void {
    workspaceDirOverride = p;
  }

  /** Create a worktree with a new branch */
  static async createWorktree(
    repoPath: string,
    branchName: string,
    worktreePath: string,
    baseBranch: string,
    createBranch: boolean
  ): Promise<void> {
    if (createBranch) {
      const result = await runCommand('git', ['branch', branchName, baseBranch], {
        cwd: repoPath,
      });
      if (result.exitCode !== 0) {
        throw new WorktreeError(`Failed to create branch: ${result.stderr}`, 'git');
      }
    }

    await WorktreeManager.ensureWorktreeExists(repoPath, branchName, worktreePath);
  }

  /**
   * Ensure worktree exists, recreating if necessary with proper synchronization.
   * This is the main entry point for ensuring a worktree exists and prevents race conditions.
   */
  static async ensureWorktreeExists(
    repoPath: string,
    branchName: string,
    worktreePath: string
  ): Promise<void> {
    const pathStr = worktreePath;

    // Get or create a lock for this specific worktree path
    const existingLock = worktreeCreationLocks.get(pathStr);
    if (existingLock) {
      await existingLock;
    }

    const lockPromise = (async () => {
      // Check if worktree already exists and is properly set up
      if (await WorktreeManager.isWorktreeProperlySetUp(repoPath, worktreePath)) {
        return;
      }

      // If worktree doesn't exist or isn't properly set up, recreate it
      await WorktreeManager.recreateWorktreeInternal(repoPath, branchName, worktreePath);
    })();

    worktreeCreationLocks.set(pathStr, lockPromise);
    try {
      await lockPromise;
    } finally {
      worktreeCreationLocks.delete(pathStr);
    }
  }

  /** Internal worktree recreation function (always recreates) */
  private static async recreateWorktreeInternal(
    repoPath: string,
    branchName: string,
    worktreePath: string
  ): Promise<void> {
    // Step 1: Comprehensive cleanup of existing worktree and metadata
    await WorktreeManager.comprehensiveWorktreeCleanupAsync(repoPath, worktreePath);

    // Step 2: Ensure parent directory exists
    const parentDir = path.dirname(worktreePath);
    await fsp.mkdir(parentDir, { recursive: true });

    // Step 3: Create the worktree with retry logic for metadata conflicts
    await WorktreeManager.createWorktreeWithRetry(repoPath, branchName, worktreePath);
  }

  /** Check if a worktree is properly set up (filesystem + git metadata) */
  private static async isWorktreeProperlySetUp(
    repoPath: string,
    worktreePath: string
  ): Promise<boolean> {
    // Check 1: Filesystem path must exist
    if (!fs.existsSync(worktreePath)) {
      return false;
    }

    // Check 2: Worktree must be registered in git metadata
    const worktreeName = WorktreeManager.findWorktreeGitInternalName(repoPath, worktreePath);
    if (!worktreeName) {
      return false;
    }

    // Verify worktree is valid by listing worktrees
    try {
      const result = await runCommand('git', ['worktree', 'list', '--porcelain'], {
        cwd: repoPath,
      });
      if (result.exitCode !== 0) return false;

      const resolvedTarget = path.resolve(worktreePath);
      const lines = result.stdout.split('\n');
      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          const wtPath = path.resolve(line.slice(9));
          if (wtPath === resolvedTarget) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  private static findWorktreeGitInternalName(
    gitRepoPath: string,
    worktreePath: string
  ): string | undefined {
    const worktreeRoot = path.resolve(normalizeMacosPrivateAlias(worktreePath));
    const worktreeMetadataPath = WorktreeManager.getWorktreeMetadataPath(gitRepoPath);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(worktreeMetadataPath, { withFileTypes: true });
    } catch (e: any) {
      if (e.code === 'ENOENT') return undefined;
      throw new WorktreeError(
        `Failed to read worktree metadata directory at ${worktreeMetadataPath}: ${e.message}`,
        'repository'
      );
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const gitdirPath = path.join(worktreeMetadataPath, entry.name, 'gitdir');
      if (!fs.existsSync(gitdirPath)) continue;
      try {
        const gitdirContent = fs.readFileSync(gitdirPath, 'utf-8').trim();
        const gitdirParent = path.resolve(
          normalizeMacosPrivateAlias(path.dirname(gitdirContent))
        );
        if (gitdirParent === worktreeRoot) {
          return entry.name;
        }
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private static getWorktreeMetadataPath(gitRepoPath: string): string {
    const gitDir = path.join(gitRepoPath, '.git');

    // If .git is a file (this repo is itself a worktree), follow the pointer
    try {
      const stat = fs.statSync(gitDir);
      if (stat.isFile()) {
        const content = fs.readFileSync(gitDir, 'utf-8').trim();
        const match = content.match(/^gitdir:\s*(.+)$/);
        if (match) {
          const actualGitDir = path.resolve(gitRepoPath, match[1]!);
          // commondir is two levels up from worktrees/<name>
          const commonDir = path.resolve(actualGitDir, '..', '..');
          return path.join(commonDir, 'worktrees');
        }
      }
    } catch {
      // fall through
    }

    return path.join(gitDir, 'worktrees');
  }

  /** Comprehensive cleanup of worktree path and metadata (sync) */
  private static comprehensiveWorktreeCleanup(
    gitRepoPath: string,
    worktreePath: string
  ): void {
    // Step 1: Use git CLI to remove the worktree registration (force)
    try {
      execSync(`git worktree remove --force "${worktreePath}"`, {
        cwd: gitRepoPath,
        stdio: 'ignore',
      });
    } catch {
      // non-fatal
    }

    // Step 2: Force cleanup metadata directory
    try {
      WorktreeManager.forceCleanupWorktreeMetadata(gitRepoPath, worktreePath);
    } catch {
      // non-fatal
    }

    // Step 3: Clean up physical worktree directory if it exists
    if (fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }

    // Step 4: Prune stale worktree entries
    try {
      execSync('git worktree prune', {
        cwd: gitRepoPath,
        stdio: 'ignore',
      });
    } catch {
      // non-fatal
    }
  }

  /** Async version of comprehensive cleanup */
  private static async comprehensiveWorktreeCleanupAsync(
    gitRepoPath: string,
    worktreePath: string
  ): Promise<void> {
    // Check if the repo exists
    const gitPath = path.join(gitRepoPath, '.git');
    if (!fs.existsSync(gitPath)) {
      // Repository doesn't exist, fall back to simple cleanup
      await WorktreeManager.simpleWorktreeCleanup(worktreePath);
      return;
    }

    WorktreeManager.comprehensiveWorktreeCleanup(gitRepoPath, worktreePath);
  }

  /** Create worktree with retry logic */
  private static async createWorktreeWithRetry(
    gitRepoPath: string,
    branchName: string,
    worktreePath: string
  ): Promise<void> {
    // Prefer git CLI for worktree add to inherit sparse-checkout semantics
    const firstAttempt = await runCommand(
      'git',
      ['worktree', 'add', worktreePath, branchName],
      { cwd: gitRepoPath }
    );

    if (firstAttempt.exitCode === 0) {
      if (!fs.existsSync(worktreePath)) {
        throw new WorktreeError(
          `Worktree creation reported success but path ${worktreePath} does not exist`,
          'repository'
        );
      }
      return;
    }

    // First attempt failed; attempt metadata cleanup and retry
    WorktreeManager.forceCleanupWorktreeMetadata(gitRepoPath, worktreePath);

    // Clean up physical directory if it exists
    if (fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }

    const secondAttempt = await runCommand(
      'git',
      ['worktree', 'add', worktreePath, branchName],
      { cwd: gitRepoPath }
    );

    if (secondAttempt.exitCode !== 0) {
      throw new WorktreeError(
        `git worktree add failed after retry: ${secondAttempt.stderr}`,
        'git_cli'
      );
    }

    if (!fs.existsSync(worktreePath)) {
      throw new WorktreeError(
        `Worktree creation reported success but path ${worktreePath} does not exist`,
        'repository'
      );
    }
  }

  /** Force cleanup worktree metadata directory */
  private static forceCleanupWorktreeMetadata(
    gitRepoPath: string,
    worktreePath: string
  ): void {
    const worktreeName = WorktreeManager.findWorktreeGitInternalName(
      gitRepoPath,
      worktreePath
    );
    if (!worktreeName) return;

    const metadataPath = path.join(
      WorktreeManager.getWorktreeMetadataPath(gitRepoPath),
      worktreeName
    );

    if (fs.existsSync(metadataPath)) {
      fs.rmSync(metadataPath, { recursive: true, force: true });
    }
  }

  /** Clean up multiple worktrees */
  static async batchCleanupWorktrees(data: WorktreeCleanup[]): Promise<void> {
    for (const cleanupData of data) {
      try {
        await WorktreeManager.cleanupWorktree(cleanupData);
      } catch (e) {
        console.error(`Failed to cleanup worktree: ${e}`);
      }
    }
  }

  /**
   * Clean up a worktree path and its git metadata.
   * If gitRepoPath is undefined, attempts to infer it from the worktree itself.
   */
  static async cleanupWorktree(worktree: WorktreeCleanup): Promise<void> {
    const pathStr = worktree.worktreePath;

    // Get the same lock to ensure we don't interfere with creation
    const existingLock = worktreeCreationLocks.get(pathStr);
    if (existingLock) {
      await existingLock;
    }

    const lockPromise = (async () => {
      // Try to determine the git repo path if not provided
      const resolvedRepoPath =
        worktree.gitRepoPath ??
        (await WorktreeManager.inferGitRepoPath(worktree.worktreePath));

      if (resolvedRepoPath) {
        await WorktreeManager.comprehensiveWorktreeCleanupAsync(
          resolvedRepoPath,
          worktree.worktreePath
        );
      } else {
        // Can't determine repo path, just clean up the worktree directory
        await WorktreeManager.simpleWorktreeCleanup(worktree.worktreePath);
      }
    })();

    worktreeCreationLocks.set(pathStr, lockPromise);
    try {
      await lockPromise;
    } finally {
      worktreeCreationLocks.delete(pathStr);
    }
  }

  /** Try to infer the git repository path from a worktree */
  private static async inferGitRepoPath(
    worktreePath: string
  ): Promise<string | undefined> {
    const gitPath = await resolveExecutablePath('git');
    if (!gitPath) return undefined;

    try {
      const result = await runCommand('git', ['rev-parse', '--git-common-dir'], {
        cwd: worktreePath,
      });

      if (result.exitCode === 0) {
        const gitCommonDir = result.stdout.trim();
        // git-common-dir gives us the path to the .git directory
        // We need the working directory (parent of .git)
        const gitDirPath = path.resolve(worktreePath, gitCommonDir);
        if (path.basename(gitDirPath) === '.git') {
          return path.dirname(gitDirPath);
        }
        return gitDirPath;
      }
    } catch {
      // ignore
    }

    return undefined;
  }

  /** Simple worktree cleanup when we can't determine the main repo */
  private static async simpleWorktreeCleanup(worktreePath: string): Promise<void> {
    if (fs.existsSync(worktreePath)) {
      await fsp.rm(worktreePath, { recursive: true, force: true });
    }
  }

  /** Move a worktree to a new location */
  static async moveWorktree(
    repoPath: string,
    oldPath: string,
    newPath: string
  ): Promise<void> {
    const result = await runCommand(
      'git',
      ['worktree', 'move', oldPath, newPath],
      { cwd: repoPath }
    );
    if (result.exitCode !== 0) {
      throw new WorktreeError(
        `git worktree move failed: ${result.stderr}`,
        'git_cli'
      );
    }
  }

  /** Get the base directory for vibe-kanban worktrees */
  static getWorktreeBaseDir(): string {
    if (workspaceDirOverride) {
      // Always use app-owned subdirectory within custom path for safety.
      // This ensures orphan cleanup never touches user's existing folders.
      return path.join(workspaceDirOverride, '.vibe-kanban-workspaces');
    }
    return WorktreeManager.getDefaultWorktreeBaseDir();
  }

  /** Get the default base directory (ignoring any override) */
  static getDefaultWorktreeBaseDir(): string {
    return path.join(getVibeKanbanTempDir(), 'worktrees');
  }

  static async cleanupSuspectedWorktree(p: string): Promise<boolean> {
    const gitMarker = path.join(p, '.git');
    try {
      const stat = fs.statSync(gitMarker);
      if (!stat.isFile()) return false;
    } catch {
      return false;
    }

    const cleanup = createWorktreeCleanup(p);
    await WorktreeManager.cleanupWorktree(cleanup);
    return true;
  }
}
