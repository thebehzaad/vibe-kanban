/**
 * Git Service - Core git operations
 * Translates: crates/git/src/lib.rs
 */

import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { GitCli, StatusDiffEntry, ChangeType, WorktreeStatus } from './cli.js';
import { isValidBranchName } from './validation.js';

/**
 * Represents a file change in a diff
 */
export interface Diff {
  change: DiffChangeKind;
  oldPath?: string;
  newPath?: string;
  oldContent?: string;
  newContent?: string;
  contentOmitted: boolean;
  additions?: number;
  deletions?: number;
  repoId?: string;
}

export enum DiffChangeKind {
  Added = 'Added',
  Deleted = 'Deleted',
  Modified = 'Modified',
  Renamed = 'Renamed',
  Copied = 'Copied',
  PermissionChange = 'PermissionChange'
}

function computeLineChangeCounts(oldContent: string, newContent: string): [number, number] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  // Simple diff - count lines
  const additions = newLines.length - oldLines.length;
  return [Math.max(0, additions), Math.max(0, -additions)];
}

// Max inline diff size for UI (in bytes)
const MAX_INLINE_DIFF_BYTES = 2 * 1024 * 1024; // ~2MB

/**
 * Statistics for a single file based on git history
 */
export interface FileStat {
  /** Index in the commit history (0 = HEAD, 1 = parent of HEAD, ...) */
  lastIndex: number;
  /** Number of times this file was changed in recent commits */
  commitCount: number;
  /** Timestamp of the most recent change */
  lastTime: Date;
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  lastCommitDate: Date;
}

export interface GitRemote {
  name: string;
  url: string;
}

export interface HeadInfo {
  branch: string;
  oid: string;
}

export class Commit {
  constructor(public readonly oid: string) {}

  toString(): string {
    return this.oid;
  }
}

export interface WorktreeResetOptions {
  performReset: boolean;
  forceWhenDirty: boolean;
  isDirty: boolean;
  logSkipWhenDirty: boolean;
}

export interface WorktreeResetOutcome {
  needed: boolean;
  applied: boolean;
}

/**
 * Target for diff generation
 */
export type DiffTarget =
  | { type: 'worktree'; worktreePath: string; baseCommit: Commit }
  | { type: 'branch'; repoPath: string; branchName: string; baseBranch: string }
  | { type: 'commit'; repoPath: string; commitSha: string };

export enum ConflictOp {
  Rebase = 'rebase',
  Merge = 'merge',
  CherryPick = 'cherry_pick',
  Revert = 'revert'
}

export class GitServiceError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'GitServiceError';
  }

  static invalidRepository(message: string): GitServiceError {
    return new GitServiceError(`Invalid repository: ${message}`, 'INVALID_REPOSITORY');
  }

  static branchNotFound(branch: string): GitServiceError {
    return new GitServiceError(`Branch not found: ${branch}`, 'BRANCH_NOT_FOUND');
  }

  static mergeConflicts(message: string, conflictedFiles: string[]): GitServiceError {
    const err = new GitServiceError(`Merge conflicts: ${message}`, 'MERGE_CONFLICTS');
    (err as any).conflictedFiles = conflictedFiles;
    return err;
  }

  static branchesDiverged(message: string): GitServiceError {
    return new GitServiceError(`Branches diverged: ${message}`, 'BRANCHES_DIVERGED');
  }

  static worktreeDirty(branch: string, details: string): GitServiceError {
    return new GitServiceError(`${branch} has uncommitted changes: ${details}`, 'WORKTREE_DIRTY');
  }

  static rebaseInProgress(): GitServiceError {
    return new GitServiceError('Rebase in progress; resolve or abort it before retrying', 'REBASE_IN_PROGRESS');
  }
}

/**
 * Service for managing Git operations in task execution workflows
 */
export class GitService {
  private gitCli: GitCli;

  constructor() {
    this.gitCli = new GitCli();
  }

  /**
   * Check if a branch name is valid
   */
  isBranchNameValid(name: string): boolean {
    return isValidBranchName(name);
  }

  /**
   * Initialize a new git repository with a main branch and initial commit
   */
  async initializeRepoWithMainBranch(repoPath: string): Promise<void> {
    await this.gitCli.git(repoPath, ['init', '--initial-branch=main']);
    await this.createInitialCommit(repoPath);
  }

  /**
   * Ensure an existing repository has a main branch (for empty repos)
   */
  async ensureMainBranchExists(repoPath: string): Promise<void> {
    const branches = await this.gitCli.git(repoPath, ['branch', '--list']);
    
    if (branches.trim().length === 0) {
      await this.createInitialCommit(repoPath);
    }
  }

  /**
   * Create initial commit
   */
  async createInitialCommit(repoPath: string): Promise<void> {
    await this.ensureCliCommitIdentity(repoPath);
    await this.gitCli.git(repoPath, ['commit', '--allow-empty', '-m', 'Initial commit']);
  }

  /**
   * Ensure local (repo-scoped) identity exists for CLI commits
   */
  private async ensureCliCommitIdentity(repoPath: string): Promise<void> {
    try {
      await this.gitCli.git(repoPath, ['config', 'user.name']);
      await this.gitCli.git(repoPath, ['config', 'user.email']);
    } catch {
      // Set default identity if missing
      await this.gitCli.git(repoPath, ['config', 'user.name', 'Vibe Kanban']);
      await this.gitCli.git(repoPath, ['config', 'user.email', 'noreply@vibekanban.com']);
    }
  }

  /**
   * Get default remote
   */
  private async defaultRemote(repoPath: string): Promise<GitRemote> {
    const remotes = await this.gitCli.listRemotes(repoPath);
    
    if (remotes.length === 0) {
      throw GitServiceError.invalidRepository('No remotes configured');
    }

    // Try to get pushDefault config
    try {
      const pushDefault = await this.gitCli.git(repoPath, ['config', 'remote.pushDefault']);
      const defaultName = pushDefault.trim();
      const remote = remotes.find(([name]) => name === defaultName);
      
      if (remote) {
        return { name: remote[0], url: remote[1] };
      }
    } catch {
      // Fall through to first remote
    }

    // Fall back to first remote
    return { name: remotes[0][0], url: remotes[0][1] };
  }

  /**
   * Commit changes
   */
  async commit(path: string, message: string): Promise<boolean> {
    const hasChanges = await this.gitCli.hasChanges(path);
    
    if (!hasChanges) {
      return false;
    }

    await this.gitCli.add(path, ['.']);
    await this.ensureCliCommitIdentity(path);
    await this.gitCli.commit(path, message);
    
    return true;
  }

  /**
   * Get diffs between branches or worktree changes
   */
  async getDiffs(
    target: DiffTarget,
    pathFilter?: string[]
  ): Promise<Diff[]> {
    switch (target.type) {
      case 'worktree':
        return this.getWorktreeDiffs(target.worktreePath, target.baseCommit, pathFilter);
      
      case 'branch':
        return this.getBranchDiffs(target.repoPath, target.branchName, target.baseBranch, pathFilter);
      
      case 'commit':
        return this.getCommitDiffs(target.repoPath, target.commitSha, pathFilter);
    }
  }

  /**
   * Get worktree diffs
   */
  private async getWorktreeDiffs(
    worktreePath: string,
    baseCommit: Commit,
    pathFilter?: string[]
  ): Promise<Diff[]> {
    const entries = await this.gitCli.diffStatus(
      worktreePath,
      baseCommit.oid,
      { pathFilter }
    );

    return entries.map(entry => this.statusEntryToDiff(worktreePath, baseCommit.oid, entry));
  }

  /**
   * Get branch diffs
   */
  private async getBranchDiffs(
    repoPath: string,
    branchName: string,
    baseBranch: string,
    pathFilter?: string[]
  ): Promise<Diff[]> {
    // TODO: Implement using git CLI
    return [];
  }

  /**
   * Get commit diffs
   */
  private async getCommitDiffs(
    repoPath: string,
    commitSha: string,
    pathFilter?: string[]
  ): Promise<Diff[]> {
    // TODO: Implement using git CLI
    return [];
  }

  /**
   * Read file content from filesystem
   */
  private async readFileContent(repoPath: string, relativePath: string): Promise<string | undefined> {
    try {
      const fullPath = join(repoPath, relativePath);
      const content = await readFile(fullPath, 'utf-8');
      return content;
    } catch {
      return undefined;
    }
  }

  /**
   * Convert StatusDiffEntry to Diff
   */
  private statusEntryToDiff(
    worktreePath: string,
    baseCommitOid: string,
    entry: StatusDiffEntry
  ): Diff {
    let change: DiffChangeKind;
    let oldPath: string | undefined;
    let newPath: string | undefined;

    // Map ChangeType to DiffChangeKind
    switch (entry.change) {
      case ChangeType.Added:
        change = DiffChangeKind.Added;
        newPath = entry.path;
        break;
      case ChangeType.Deleted:
        change = DiffChangeKind.Deleted;
        oldPath = entry.oldPath || entry.path;
        break;
      case ChangeType.Modified:
      case ChangeType.TypeChanged:
      case ChangeType.Unmerged:
        change = DiffChangeKind.Modified;
        oldPath = entry.oldPath || entry.path;
        newPath = entry.path;
        break;
      case ChangeType.Renamed:
        change = DiffChangeKind.Renamed;
        oldPath = entry.oldPath;
        newPath = entry.path;
        break;
      case ChangeType.Copied:
        change = DiffChangeKind.Copied;
        oldPath = entry.oldPath;
        newPath = entry.path;
        break;
      default:
        change = DiffChangeKind.Modified;
        oldPath = entry.oldPath || entry.path;
        newPath = entry.path;
    }

    // For now, return without content (TODO: implement content loading)
    return {
      change,
      oldPath,
      newPath,
      oldContent: undefined,
      newContent: undefined,
      contentOmitted: false,
      additions: undefined,
      deletions: undefined,
      repoId: undefined
    };
  }

  /**
   * Extract file path from a Diff
   */
  static diffPath(diff: Diff): string {
    return diff.newPath || diff.oldPath || '';
  }

  /**
   * Get branch status (ahead, behind counts)
   */
  async getBranchStatus(
    repoPath: string,
    branchName: string,
    baseBranchName: string
  ): Promise<[number, number]> {
    const result = await this.gitCli.git(repoPath, ['rev-list', '--left-right', '--count', `${baseBranchName}...${branchName}`]);
    
    const parts = result.trim().split(/\s+/);
    const behind = parseInt(parts[0] || '0', 10);
    const ahead = parseInt(parts[1] || '0', 10);
    
    return [ahead, behind];
  }

  /**
   * Get base commit (merge base)
   */
  async getBaseCommit(
    repoPath: string,
    branchName: string,
    baseBranchName: string
  ): Promise<Commit> {
    const oid = await this.gitCli.git(repoPath, ['merge-base', branchName, baseBranchName]);
    return new Commit(oid.trim());
  }

  /**
   * Check if worktree is clean
   */
  async isWorktreeClean(worktreePath: string): Promise<boolean> {
    try {
      await this.checkWorktreeClean(worktreePath);
      return true;
    } catch (err) {
      if (err instanceof GitServiceError && err.code === 'WORKTREE_DIRTY') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Check if worktree is clean (throws if dirty)
   */
  private async checkWorktreeClean(worktreePath: string): Promise<void> {
    const status = await this.getWorktreeStatus(worktreePath);
    
    if (status.entries.length > 0) {
      const dirtyFiles = status.entries.slice(0, 10).map(e => e.path.toString()).join(', ');
      const branch = await this.getCurrentBranch(worktreePath);
      throw GitServiceError.worktreeDirty(branch, dirtyFiles);
    }
  }

  /**
   * Get HEAD information
   */
  async getHeadInfo(repoPath: string): Promise<HeadInfo> {
    const branch = await this.gitCli.git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const oid = await this.gitCli.git(repoPath, ['rev-parse', 'HEAD']);
    
    return {
      branch: branch.trim(),
      oid: oid.trim()
    };
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(repoPath: string): Promise<string> {
    const headInfo = await this.getHeadInfo(repoPath);
    return headInfo.branch;
  }

  /**
   * Get branch OID
   */
  async getBranchOid(repoPath: string, branchName: string): Promise<string> {
    const oid = await this.gitCli.git(repoPath, ['rev-parse', branchName]);
    return oid.trim();
  }

  /**
   * Get fork point (merge base)
   */
  async getForkPoint(
    worktreePath: string,
    targetBranch: string,
    taskBranch: string
  ): Promise<string> {
    const oid = await this.gitCli.git(worktreePath, ['merge-base', targetBranch, taskBranch]);
    return oid.trim();
  }

  /**
   * Get commit subject line
   */
  async getCommitSubject(repoPath: string, commitSha: string): Promise<string> {
    const result = await this.gitCli.git(repoPath, ['show', commitSha, '--format=%s', '--no-patch']);
    return result.trim();
  }

  /**
   * Get worktree status
   */
  async getWorktreeStatus(worktreePath: string): Promise<WorktreeStatus> {
    return this.gitCli.getWorktreeStatus(worktreePath);
  }

  /**
   * Get worktree change counts
   */
  async getWorktreeChangeCounts(worktreePath: string): Promise<[number, number]> {
    const status = await this.getWorktreeStatus(worktreePath);
    return [status.uncommittedTracked, status.untracked];
  }

  /**
   * Reset worktree to commit
   */
  async resetWorktreeToCommit(
    worktreePath: string,
    commitSha: string,
    force: boolean = false
  ): Promise<void> {
    if (!force) {
      await this.checkWorktreeClean(worktreePath);
    }

    await this.gitCli.git(worktreePath, ['reset', '--hard', commitSha]);
    
    // Reapply sparse-checkout if configured (non-fatal)
    try {
      await this.gitCli.git(worktreePath, ['sparse-checkout', 'reapply']);
    } catch {
      // Ignore errors
    }
  }

  /**
   * Add a worktree
   */
  async addWorktree(
    repoPath: string,
    worktreePath: string,
    branch: string,
    createBranch: boolean = false
  ): Promise<void> {
    await this.gitCli.worktreeAdd(repoPath, worktreePath, branch, createBranch);
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(
    repoPath: string,
    worktreePath: string,
    force: boolean = false
  ): Promise<void> {
    await this.gitCli.worktreeRemove(repoPath, worktreePath, force);
  }

  /**
   * Move a worktree
   */
  async moveWorktree(
    repoPath: string,
    oldPath: string,
    newPath: string
  ): Promise<void> {
    await this.gitCli.worktreeMove(repoPath, oldPath, newPath);
  }

  /**
   * Prune worktrees
   */
  async pruneWorktrees(repoPath: string): Promise<void> {
    await this.gitCli.worktreePrune(repoPath);
  }

  /**
   * Get all branches
   */
  async getAllBranches(repoPath: string): Promise<GitBranch[]> {
    // TODO: Implement using git CLI
    return [];
  }

  /**
   * Check if branch exists
   */
  async checkBranchExists(repoPath: string, branchName: string): Promise<boolean> {
    try {
      await this.gitCli.git(repoPath, ['rev-parse', branchName]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Collect recent file stats for ranking
   */
  async collectRecentFileStats(
    repoPath: string,
    commitLimit: number = 100
  ): Promise<Map<string, FileStat>> {
    // TODO: Implement using git CLI
    return new Map();
  }
}

// Re-export types from cli
export { WorktreeStatus, StatusEntry } from './cli.js';

