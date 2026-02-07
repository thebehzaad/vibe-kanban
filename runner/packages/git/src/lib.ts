/**
 * Git service and types
 * Translates: crates/git/src/lib.rs
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Diff,
  type DiffChangeKind,
  computeLineChangeCounts,
  ALWAYS_SKIP_DIRS,
} from '@runner/utils';

import {
  GitCli,
  GitCliError,
  type StatusDiffEntry,
  type StatusDiffOptions,
  ChangeType,
  type WorktreeStatus,
  type StatusEntry,
} from './cli.js';
import { isValidBranchName } from './validation.js';

// Re-exports matching Rust: pub use cli::{...}
export { GitCli, GitCliError } from './cli.js';
export type { StatusEntry, WorktreeStatus } from './cli.js';

// Re-exports matching Rust: pub use utils::path::ALWAYS_SKIP_DIRS
export { ALWAYS_SKIP_DIRS } from '@runner/utils';

// Re-exports matching Rust: pub use validation::is_valid_branch_prefix
export { isValidBranchPrefix, isValidBranchName } from './validation.js';

// Re-export Diff types from utils (used by consumers via git crate in Rust)
export type { Diff, DiffChangeKind } from '@runner/utils';

// ── Types matching lib.rs ──

// Max inline diff size for UI (in bytes).
const MAX_INLINE_DIFF_BYTES = 2 * 1024 * 1024; // ~2MB

export interface FileStat {
  lastIndex: number;
  commitCount: number;
  lastTime: Date;
}

export enum ConflictOp {
  Rebase = 'rebase',
  Merge = 'merge',
  CherryPick = 'cherry_pick',
  Revert = 'revert',
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

export type DiffTarget =
  | { type: 'worktree'; worktreePath: string; baseCommit: Commit }
  | { type: 'branch'; repoPath: string; branchName: string; baseBranch: string }
  | { type: 'commit'; repoPath: string; commitSha: string };

export type BranchType = 'local' | 'remote';

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

// ── GitService ──

export class GitService {
  private gitCli: GitCli;

  constructor() {
    this.gitCli = new GitCli();
  }

  isBranchNameValid(name: string): boolean {
    return isValidBranchName(name);
  }

  // ── Repository initialization ──

  async initializeRepoWithMainBranch(repoPath: string): Promise<void> {
    await this.gitCli.git(repoPath, ['init', '--initial-branch=main']);
    await this.createInitialCommit(repoPath);
  }

  async ensureMainBranchExists(repoPath: string): Promise<void> {
    const branches = await this.gitCli.git(repoPath, ['branch', '--list']);
    if (branches.trim().length === 0) {
      await this.createInitialCommit(repoPath);
    }
  }

  async createInitialCommit(repoPath: string): Promise<void> {
    await this.ensureCliCommitIdentity(repoPath);
    await this.gitCli.git(repoPath, ['commit', '--allow-empty', '-m', 'Initial commit']);
  }

  // ── Commit ──

  async commit(path: string, message: string): Promise<boolean> {
    const hasChanges = await this.gitCli.hasChanges(path);
    if (!hasChanges) {
      return false;
    }
    await this.gitCli.addAll(path);
    await this.ensureCliCommitIdentity(path);
    await this.gitCli.commit(path, message);
    return true;
  }

  // ── Diffs ──

  async getDiffs(target: DiffTarget, pathFilter?: string[]): Promise<Diff[]> {
    switch (target.type) {
      case 'worktree':
        return this.getWorktreeDiffs(target.worktreePath, target.baseCommit, pathFilter);
      case 'branch':
        return this.getBranchDiffs(target.repoPath, target.branchName, target.baseBranch, pathFilter);
      case 'commit':
        return this.getCommitDiffs(target.repoPath, target.commitSha, pathFilter);
    }
  }

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
    const diffs: Diff[] = [];
    for (const entry of entries) {
      diffs.push(await this.statusEntryToDiff(worktreePath, baseCommit.oid, entry));
    }
    return diffs;
  }

  private async getBranchDiffs(
    repoPath: string,
    branchName: string,
    baseBranch: string,
    pathFilter?: string[]
  ): Promise<Diff[]> {
    // Use git diff --name-status between branches
    let args = ['diff', '--name-status', '-M', `${baseBranch}...${branchName}`];
    if (pathFilter && pathFilter.length > 0) {
      args.push('--', ...pathFilter);
    }
    const out = await this.gitCli.git(repoPath, args);
    const entries = this.parseNameStatusOutput(out);
    const diffs: Diff[] = [];
    for (const entry of entries) {
      diffs.push(await this.branchEntryToDiff(repoPath, baseBranch, branchName, entry));
    }
    return diffs;
  }

  private async getCommitDiffs(
    repoPath: string,
    commitSha: string,
    pathFilter?: string[]
  ): Promise<Diff[]> {
    // Diff parent..commit
    let args = ['diff', '--name-status', '-M', `${commitSha}^..${commitSha}`];
    if (pathFilter && pathFilter.length > 0) {
      args.push('--', ...pathFilter);
    }
    const out = await this.gitCli.git(repoPath, args);
    const entries = this.parseNameStatusOutput(out);
    const diffs: Diff[] = [];
    for (const entry of entries) {
      diffs.push(await this.commitEntryToDiff(repoPath, commitSha, entry));
    }
    return diffs;
  }

  static diffPath(diff: Diff): string {
    return diff.newPath || diff.oldPath || '';
  }

  // ── Branch status ──

  async getBranchStatus(
    repoPath: string,
    branchName: string,
    baseBranchName: string
  ): Promise<[number, number]> {
    const result = await this.gitCli.git(
      repoPath,
      ['rev-list', '--left-right', '--count', `${baseBranchName}...${branchName}`]
    );
    const parts = result.trim().split(/\s+/);
    const behind = parseInt(parts[0] || '0', 10);
    const ahead = parseInt(parts[1] || '0', 10);
    return [ahead, behind];
  }

  async getBaseCommit(
    repoPath: string,
    branchName: string,
    baseBranchName: string
  ): Promise<Commit> {
    const oid = await this.gitCli.git(repoPath, ['merge-base', branchName, baseBranchName]);
    return new Commit(oid.trim());
  }

  async getRemoteBranchStatus(
    repoPath: string,
    branchName: string,
    baseBranchName?: string
  ): Promise<[number, number]> {
    // Determine base ref
    let baseRef: string;
    if (baseBranchName) {
      baseRef = baseBranchName;
    } else {
      // Try to get upstream
      try {
        const upstream = await this.gitCli.git(
          repoPath,
          ['rev-parse', '--abbrev-ref', `${branchName}@{upstream}`]
        );
        baseRef = upstream.trim();
      } catch {
        throw GitServiceError.invalidRepository(`No upstream configured for ${branchName}`);
      }
    }

    // Fetch from remote to get latest
    const remote = await this.resolveRemoteForBranch(repoPath, baseRef);
    const refspec = `+refs/heads/*:refs/remotes/${remote.name}/*`;
    await this.gitCli.fetchWithRefspec(repoPath, remote.url, refspec);

    return this.getBranchStatus(repoPath, branchName, baseRef);
  }

  async aheadBehindCommitsByOid(
    repoPath: string,
    fromOid: string,
    toOid: string
  ): Promise<[number, number]> {
    const result = await this.gitCli.git(
      repoPath,
      ['rev-list', '--left-right', '--count', `${toOid}...${fromOid}`]
    );
    const parts = result.trim().split(/\s+/);
    const behind = parseInt(parts[0] || '0', 10);
    const ahead = parseInt(parts[1] || '0', 10);
    return [ahead, behind];
  }

  // ── Worktree status ──

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

  private async checkWorktreeClean(worktreePath: string): Promise<void> {
    const status = await this.getWorktreeStatus(worktreePath);
    // Only check tracked changes — untracked files are allowed (matching Rust)
    const dirtyEntries = status.entries.filter(e => !e.isUntracked);
    if (dirtyEntries.length > 0) {
      const dirtyFiles = dirtyEntries.slice(0, 10).map(e => e.path.toString()).join(', ');
      const branch = await this.getCurrentBranch(worktreePath);
      throw GitServiceError.worktreeDirty(branch, dirtyFiles);
    }
  }

  async getHeadInfo(repoPath: string): Promise<HeadInfo> {
    const branch = await this.gitCli.git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const oid = await this.gitCli.git(repoPath, ['rev-parse', 'HEAD']);
    return { branch: branch.trim(), oid: oid.trim() };
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    const headInfo = await this.getHeadInfo(repoPath);
    return headInfo.branch;
  }

  async getBranchOid(repoPath: string, branchName: string): Promise<string> {
    const oid = await this.gitCli.git(repoPath, ['rev-parse', branchName]);
    return oid.trim();
  }

  async getForkPoint(
    worktreePath: string,
    targetBranch: string,
    taskBranch: string
  ): Promise<string> {
    return this.gitCli.mergeBase(worktreePath, targetBranch, taskBranch);
  }

  async getCommitSubject(repoPath: string, commitSha: string): Promise<string> {
    const result = await this.gitCli.git(repoPath, ['show', commitSha, '--format=%s', '--no-patch']);
    return result.trim();
  }

  async getWorktreeStatus(worktreePath: string): Promise<WorktreeStatus> {
    return this.gitCli.getWorktreeStatus(worktreePath);
  }

  async getWorktreeChangeCounts(worktreePath: string): Promise<[number, number]> {
    const status = await this.getWorktreeStatus(worktreePath);
    return [status.uncommittedTracked, status.untracked];
  }

  // ── Worktree reset / reconcile ──

  reconcileWorktreeToCommit(
    worktreePath: string,
    targetCommitOid: string,
    options: WorktreeResetOptions
  ): WorktreeResetOutcome {
    const { performReset, forceWhenDirty, isDirty, logSkipWhenDirty } = options;
    let headOid: string | undefined;
    try {
      // Synchronous-ish: we call this in a non-async context matching Rust
      // In practice callers should use the async version below
    } catch {
      // ignore
    }

    // This needs to be async in TS; provide async version
    return { needed: false, applied: false };
  }

  async reconcileWorktreeToCommitAsync(
    worktreePath: string,
    targetCommitOid: string,
    options: WorktreeResetOptions
  ): Promise<WorktreeResetOutcome> {
    const { performReset, forceWhenDirty, isDirty, logSkipWhenDirty } = options;

    let headOid: string | undefined;
    try {
      const headInfo = await this.getHeadInfo(worktreePath);
      headOid = headInfo.oid;
    } catch {
      // ignore
    }

    const outcome: WorktreeResetOutcome = { needed: false, applied: false };

    if (headOid !== targetCommitOid || isDirty) {
      outcome.needed = true;

      if (performReset) {
        if (isDirty && !forceWhenDirty) {
          if (logSkipWhenDirty) {
            console.warn('Worktree dirty; skipping reset as not forced');
          }
        } else {
          try {
            await this.resetWorktreeToCommit(worktreePath, targetCommitOid, forceWhenDirty);
            outcome.applied = true;
          } catch (e) {
            console.error('Failed to reset worktree:', e);
          }
        }
      }
    }

    return outcome;
  }

  async resetWorktreeToCommit(
    worktreePath: string,
    commitSha: string,
    force: boolean = false
  ): Promise<void> {
    if (!force) {
      await this.checkWorktreeClean(worktreePath);
    }
    await this.gitCli.git(worktreePath, ['reset', '--hard', commitSha]);
    try {
      await this.gitCli.git(worktreePath, ['sparse-checkout', 'reapply']);
    } catch {
      // Non-fatal
    }
  }

  // ── Worktree management ──

  async addWorktree(
    repoPath: string,
    worktreePath: string,
    branch: string,
    createBranch: boolean = false
  ): Promise<void> {
    await this.gitCli.worktreeAdd(repoPath, worktreePath, branch, createBranch);
  }

  async removeWorktree(
    repoPath: string,
    worktreePath: string,
    force: boolean = false
  ): Promise<void> {
    await this.gitCli.worktreeRemove(repoPath, worktreePath, force);
  }

  async moveWorktree(repoPath: string, oldPath: string, newPath: string): Promise<void> {
    await this.gitCli.worktreeMove(repoPath, oldPath, newPath);
  }

  async pruneWorktrees(repoPath: string): Promise<void> {
    await this.gitCli.worktreePrune(repoPath);
  }

  // ── Branch operations ──

  async getAllBranches(repoPath: string): Promise<GitBranch[]> {
    const currentBranch = await this.getCurrentBranch(repoPath).catch(() => '');
    const branches: GitBranch[] = [];

    // Local branches
    const localOut = await this.gitCli.git(repoPath, [
      'for-each-ref', '--format=%(refname:short)\t%(committerdate:iso-strict)',
      'refs/heads/'
    ]);
    for (const line of localOut.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const [name, dateStr] = trimmed.split('\t');
      if (!name) continue;
      branches.push({
        name,
        isCurrent: name === currentBranch,
        isRemote: false,
        lastCommitDate: dateStr ? new Date(dateStr) : new Date(),
      });
    }

    // Remote branches
    const remoteOut = await this.gitCli.git(repoPath, [
      'for-each-ref', '--format=%(refname:short)\t%(committerdate:iso-strict)',
      'refs/remotes/'
    ]);
    for (const line of remoteOut.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const [name, dateStr] = trimmed.split('\t');
      if (!name || name.endsWith('/HEAD')) continue;
      branches.push({
        name,
        isCurrent: false,
        isRemote: true,
        lastCommitDate: dateStr ? new Date(dateStr) : new Date(),
      });
    }

    // Sort: current first, then by most recent commit date
    branches.sort((a, b) => {
      if (a.isCurrent && !b.isCurrent) return -1;
      if (!a.isCurrent && b.isCurrent) return 1;
      return b.lastCommitDate.getTime() - a.lastCommitDate.getTime();
    });

    return branches;
  }

  async findBranchType(repoPath: string, branchName: string): Promise<BranchType> {
    // Try local first
    try {
      await this.gitCli.git(repoPath, ['show-ref', '--verify', `refs/heads/${branchName}`]);
      return 'local';
    } catch {
      // Try remote
      try {
        await this.gitCli.git(repoPath, ['show-ref', '--verify', `refs/remotes/${branchName}`]);
        return 'remote';
      } catch {
        throw GitServiceError.branchNotFound(branchName);
      }
    }
  }

  async checkBranchExists(repoPath: string, branchName: string): Promise<boolean> {
    try {
      await this.findBranchType(repoPath, branchName);
      return true;
    } catch {
      return false;
    }
  }

  async renameLocalBranch(
    worktreePath: string,
    oldBranchName: string,
    newBranchName: string
  ): Promise<void> {
    await this.gitCli.git(worktreePath, ['branch', '-m', oldBranchName, newBranchName]);
    await this.gitCli.git(worktreePath, ['symbolic-ref', 'HEAD', `refs/heads/${newBranchName}`]);
  }

  // ── Merge ──

  async mergeChanges(
    baseWorktreePath: string,
    _taskWorktreePath: string,
    taskBranchName: string,
    baseBranchName: string,
    commitMessage: string
  ): Promise<string> {
    // Check if base branch is ahead of task branch
    const [, taskBehind] = await this.getBranchStatus(
      baseWorktreePath, taskBranchName, baseBranchName
    );

    if (taskBehind > 0) {
      throw GitServiceError.branchesDiverged(
        `Cannot merge: base branch '${baseBranchName}' is ${taskBehind} commits ahead of task branch '${taskBranchName}'. The base branch has moved forward since the task was created.`
      );
    }

    // Find where base branch is checked out
    const baseCheckoutPath = await this.findCheckoutPathForBranch(
      baseWorktreePath, baseBranchName
    );

    const checkPath = baseCheckoutPath ?? baseWorktreePath;

    // Safety check: no staged changes
    if (await this.gitCli.hasStagedChanges(checkPath)) {
      throw GitServiceError.worktreeDirty(baseBranchName, 'staged changes present');
    }

    await this.ensureCliCommitIdentity(checkPath);
    const sha = await this.gitCli.mergeSquashCommit(
      checkPath, baseBranchName, taskBranchName, commitMessage
    );

    // Update task branch ref for continuity
    const taskRefname = `refs/heads/${taskBranchName}`;
    await this.gitCli.updateRef(baseWorktreePath, taskRefname, sha);

    return sha;
  }

  // ── Rebase ──

  async rebaseBranch(
    repoPath: string,
    worktreePath: string,
    newBaseBranch: string,
    oldBaseBranch: string,
    taskBranch: string
  ): Promise<string> {
    // Safety: check worktree is clean
    await this.checkWorktreeClean(worktreePath);

    // Refuse if rebase already in progress
    if (await this.gitCli.isRebaseInProgress(worktreePath)) {
      throw GitServiceError.rebaseInProgress();
    }

    // If base is remote, fetch it
    try {
      const branchType = await this.findBranchType(repoPath, newBaseBranch);
      if (branchType === 'remote') {
        const remote = await this.resolveRemoteForBranch(repoPath, newBaseBranch);
        const refspec = `+refs/heads/*:refs/remotes/${remote.name}/*`;
        await this.gitCli.fetchWithRefspec(repoPath, remote.url, refspec);
      }
    } catch {
      // Non-fatal: proceed with local refs
    }

    await this.ensureCliCommitIdentity(worktreePath);

    try {
      await this.gitCli.rebaseOnto(worktreePath, newBaseBranch, oldBaseBranch, taskBranch);
    } catch (err) {
      if (err instanceof GitCliError && err.code === 'REBASE_IN_PROGRESS') {
        throw GitServiceError.rebaseInProgress();
      }
      if (err instanceof GitCliError && err.code === 'COMMAND_FAILED') {
        const stderr = err.message;
        const looksLikeConflict = stderr.includes('could not apply') ||
          stderr.includes('CONFLICT') ||
          stderr.toLowerCase().includes('resolve all conflicts');

        if (looksLikeConflict) {
          const conflictedFiles = await this.gitCli.getConflictedFiles(worktreePath).catch(() => []);
          let filesMsg = '';
          if (conflictedFiles.length > 0) {
            const sample = conflictedFiles.slice(0, 10);
            const list = sample.join(', ');
            filesMsg = conflictedFiles.length > sample.length
              ? ` Conflicted files (showing ${sample.length} of ${conflictedFiles.length}): ${list}.`
              : ` Conflicted files: ${list}.`;
          }
          throw GitServiceError.mergeConflicts(
            `Rebase encountered merge conflicts while rebasing '${taskBranch}' onto '${newBaseBranch}'.${filesMsg} Resolve conflicts and then continue or abort.`,
            conflictedFiles
          );
        }

        throw GitServiceError.invalidRepository(
          `Rebase failed: ${stderr.split('\n')[0] || ''}`
        );
      }
      throw err;
    }

    // Return resulting HEAD commit
    const headInfo = await this.getHeadInfo(worktreePath);
    return headInfo.oid;
  }

  // ── Conflict detection / resolution ──

  async isRebaseInProgress(worktreePath: string): Promise<boolean> {
    return this.gitCli.isRebaseInProgress(worktreePath);
  }

  async detectConflictOp(worktreePath: string): Promise<ConflictOp | null> {
    if (await this.gitCli.isRebaseInProgress(worktreePath).catch(() => false)) {
      return ConflictOp.Rebase;
    }
    if (await this.gitCli.isMergeInProgress(worktreePath).catch(() => false)) {
      return ConflictOp.Merge;
    }
    if (await this.gitCli.isCherryPickInProgress(worktreePath).catch(() => false)) {
      return ConflictOp.CherryPick;
    }
    if (await this.gitCli.isRevertInProgress(worktreePath).catch(() => false)) {
      return ConflictOp.Revert;
    }
    return null;
  }

  async getConflictedFiles(worktreePath: string): Promise<string[]> {
    return this.gitCli.getConflictedFiles(worktreePath);
  }

  async abortRebase(worktreePath: string): Promise<void> {
    await this.gitCli.abortRebase(worktreePath);
  }

  async continueRebase(worktreePath: string): Promise<void> {
    await this.gitCli.continueRebase(worktreePath);
  }

  async abortConflicts(worktreePath: string): Promise<void> {
    if (await this.gitCli.isRebaseInProgress(worktreePath).catch(() => false)) {
      const hasConflicts = (await this.getConflictedFiles(worktreePath).catch(() => [])).length > 0;
      if (hasConflicts) {
        await this.gitCli.abortRebase(worktreePath);
      } else {
        await this.gitCli.quitRebase(worktreePath);
      }
      return;
    }
    if (await this.gitCli.isMergeInProgress(worktreePath).catch(() => false)) {
      await this.gitCli.abortMerge(worktreePath);
      return;
    }
    if (await this.gitCli.isCherryPickInProgress(worktreePath).catch(() => false)) {
      await this.gitCli.abortCherryPick(worktreePath);
      return;
    }
    if (await this.gitCli.isRevertInProgress(worktreePath).catch(() => false)) {
      await this.gitCli.abortRevert(worktreePath);
      return;
    }
  }

  // ── Remote operations ──

  async getRemoteFromBranchName(repoPath: string, branchName: string): Promise<GitRemote> {
    try {
      const remoteName = await this.gitCli.git(
        repoPath,
        ['config', `branch.${branchName}.remote`]
      );
      const name = remoteName.trim();
      const url = await this.gitCli.getRemoteUrl(repoPath, name);
      return { name, url };
    } catch {
      throw GitServiceError.invalidRepository(`No remote configured for branch '${branchName}'`);
    }
  }

  async getRemoteUrl(repoPath: string, remoteName: string): Promise<string> {
    return this.gitCli.getRemoteUrl(repoPath, remoteName);
  }

  async getDefaultRemote(repoPath: string): Promise<GitRemote> {
    return this.defaultRemote(repoPath);
  }

  async listRemotes(repoPath: string): Promise<GitRemote[]> {
    const remotes = await this.gitCli.listRemotes(repoPath);
    return remotes.map(([name, url]) => ({ name, url }));
  }

  async checkRemoteBranchExists(
    repoPath: string,
    remoteUrl: string,
    branchName: string
  ): Promise<boolean> {
    return this.gitCli.checkRemoteBranchExists(repoPath, remoteUrl, branchName);
  }

  async fetchBranch(
    repoPath: string,
    remoteUrl: string,
    branchName: string
  ): Promise<void> {
    const refspec = `+refs/heads/${branchName}:refs/heads/${branchName}`;
    await this.gitCli.fetchWithRefspec(repoPath, remoteUrl, refspec);
  }

  async resolveRemoteForBranch(repoPath: string, branchName: string): Promise<GitRemote> {
    try {
      return await this.getRemoteFromBranchName(repoPath, branchName);
    } catch {
      return this.getDefaultRemote(repoPath);
    }
  }

  async pushToRemote(
    worktreePath: string,
    branchName: string,
    force: boolean = false
  ): Promise<void> {
    await this.checkWorktreeClean(worktreePath);
    const remote = await this.defaultRemote(worktreePath);
    await this.gitCli.push(worktreePath, remote.url, branchName, force);

    // Set upstream tracking
    try {
      await this.gitCli.git(
        worktreePath,
        ['branch', `--set-upstream-to=${remote.name}/${branchName}`, branchName]
      );
    } catch {
      // Non-fatal
    }
  }

  // ── File stats ──

  async collectRecentFileStats(
    repoPath: string,
    commitLimit: number = 100
  ): Promise<Map<string, FileStat>> {
    const stats = new Map<string, FileStat>();

    // git log with --name-only to get changed files per commit
    const out = await this.gitCli.git(repoPath, [
      'log', `--max-count=${commitLimit}`,
      '--format=%H %aI',
      '--name-only',
    ]);

    let commitIndex = 0;
    let currentTime: Date | undefined;
    let inFiles = false;

    for (const line of out.split('\n')) {
      const trimmed = line.trim();

      if (trimmed.length === 0) {
        if (inFiles) {
          commitIndex++;
          inFiles = false;
          currentTime = undefined;
        }
        continue;
      }

      // Check if this is a commit header line (sha + date)
      if (!inFiles && trimmed.match(/^[0-9a-f]{40}\s/)) {
        const dateStr = trimmed.split(' ').slice(1).join(' ');
        currentTime = new Date(dateStr);
        inFiles = true;
        continue;
      }

      // File path
      if (inFiles && currentTime) {
        const filePath = trimmed;
        const existing = stats.get(filePath);
        if (existing) {
          existing.commitCount++;
          if (commitIndex < existing.lastIndex) {
            existing.lastIndex = commitIndex;
            existing.lastTime = currentTime;
          }
        } else {
          stats.set(filePath, {
            lastIndex: commitIndex,
            commitCount: 1,
            lastTime: currentTime,
          });
        }
      }
    }

    return stats;
  }

  // ── Private helpers ──

  private async ensureCliCommitIdentity(repoPath: string): Promise<void> {
    try {
      await this.gitCli.git(repoPath, ['config', 'user.name']);
      await this.gitCli.git(repoPath, ['config', 'user.email']);
    } catch {
      await this.gitCli.git(repoPath, ['config', 'user.name', 'Vibe Kanban']);
      await this.gitCli.git(repoPath, ['config', 'user.email', 'noreply@vibekanban.com']);
    }
  }

  private async defaultRemote(repoPath: string): Promise<GitRemote> {
    const remotes = await this.gitCli.listRemotes(repoPath);
    if (remotes.length === 0) {
      throw GitServiceError.invalidRepository('No remotes configured');
    }

    // Check for pushDefault config
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

    const first = remotes[0];
    if (!first) throw GitServiceError.invalidRepository('No remotes configured');
    return { name: first[0], url: first[1] };
  }

  private async findCheckoutPathForBranch(
    repoPath: string,
    branchName: string
  ): Promise<string | undefined> {
    const worktrees = await this.gitCli.listWorktrees(repoPath);
    for (const wt of worktrees) {
      if (wt.branch === branchName) {
        return wt.path;
      }
    }
    return undefined;
  }

  private async readFileContent(basePath: string, relativePath: string): Promise<string | undefined> {
    try {
      const fullPath = join(basePath, relativePath);
      const fileStat = await stat(fullPath);
      if (fileStat.size > MAX_INLINE_DIFF_BYTES) return undefined;
      const content = await readFile(fullPath, 'utf-8');
      // Binary guard
      if (content.includes('\0')) return undefined;
      return content;
    } catch {
      return undefined;
    }
  }

  private async getOldContent(
    repoPath: string,
    commitOrBranch: string,
    filePath: string
  ): Promise<string | undefined> {
    try {
      const content = await this.gitCli.git(repoPath, ['show', `${commitOrBranch}:${filePath}`]);
      if (content.length > MAX_INLINE_DIFF_BYTES) return undefined;
      if (content.includes('\0')) return undefined;
      return content;
    } catch {
      return undefined;
    }
  }

  private async statusEntryToDiff(
    worktreePath: string,
    baseCommitOid: string,
    entry: StatusDiffEntry
  ): Promise<Diff> {
    let change = this.changeTypeToDiffKind(entry.change);
    let oldPath: string | undefined;
    let newPath: string | undefined;

    switch (entry.change) {
      case ChangeType.Added:
        newPath = entry.path;
        break;
      case ChangeType.Deleted:
        oldPath = entry.oldPath || entry.path;
        break;
      case ChangeType.Modified:
      case ChangeType.TypeChanged:
      case ChangeType.Unmerged:
        oldPath = entry.oldPath || entry.path;
        newPath = entry.path;
        break;
      case ChangeType.Renamed:
      case ChangeType.Copied:
        oldPath = entry.oldPath;
        newPath = entry.path;
        break;
      default:
        oldPath = entry.oldPath || entry.path;
        newPath = entry.path;
    }

    // Load content
    let oldContent: string | undefined;
    let newContent: string | undefined;
    let contentOmitted = false;

    if (oldPath) {
      oldContent = await this.getOldContent(worktreePath, baseCommitOid, oldPath);
      if (oldContent === undefined && entry.change !== ChangeType.Added) {
        // Check if it was size-omitted
        try {
          const out = await this.gitCli.git(worktreePath, ['cat-file', '-s', `${baseCommitOid}:${oldPath}`]);
          if (parseInt(out.trim(), 10) > MAX_INLINE_DIFF_BYTES) contentOmitted = true;
        } catch { /* ignore */ }
      }
    }
    if (newPath) {
      newContent = await this.readFileContent(worktreePath, newPath);
      if (newContent === undefined && entry.change !== ChangeType.Deleted) {
        try {
          const fileStat = await stat(join(worktreePath, newPath));
          if (fileStat.size > MAX_INLINE_DIFF_BYTES) contentOmitted = true;
        } catch { /* ignore */ }
      }
    }

    // Detect permission-only change
    if (change === 'Modified' && oldContent !== undefined && newContent !== undefined && oldContent === newContent) {
      change = 'PermissionChange';
    }

    // Compute line stats
    let additions: number | undefined;
    let deletions: number | undefined;
    if (oldContent !== undefined && newContent !== undefined) {
      const counts = computeLineChangeCounts(oldContent, newContent);
      additions = counts.additions;
      deletions = counts.deletions;
    } else if (oldContent !== undefined && newContent === undefined && entry.change === ChangeType.Deleted) {
      additions = 0;
      deletions = oldContent.split('\n').length;
    } else if (oldContent === undefined && newContent !== undefined && entry.change === ChangeType.Added) {
      additions = newContent.split('\n').length;
      deletions = 0;
    }

    return {
      change,
      oldPath,
      newPath,
      oldContent,
      newContent,
      contentOmitted,
      additions,
      deletions,
      repoId: undefined,
    };
  }

  private async branchEntryToDiff(
    repoPath: string,
    baseBranch: string,
    branchName: string,
    entry: StatusDiffEntry
  ): Promise<Diff> {
    const change = this.changeTypeToDiffKind(entry.change);
    let oldPath: string | undefined;
    let newPath: string | undefined;

    if (entry.change === ChangeType.Added) { newPath = entry.path; }
    else if (entry.change === ChangeType.Deleted) { oldPath = entry.oldPath || entry.path; }
    else { oldPath = entry.oldPath || entry.path; newPath = entry.path; }

    const oldContent = oldPath ? await this.getOldContent(repoPath, baseBranch, oldPath) : undefined;
    const newContent = newPath ? await this.getOldContent(repoPath, branchName, newPath) : undefined;

    let additions: number | undefined;
    let deletions: number | undefined;
    if (oldContent !== undefined && newContent !== undefined) {
      const counts = computeLineChangeCounts(oldContent, newContent);
      additions = counts.additions;
      deletions = counts.deletions;
    }

    return {
      change, oldPath, newPath, oldContent, newContent,
      contentOmitted: false, additions, deletions, repoId: undefined,
    };
  }

  private async commitEntryToDiff(
    repoPath: string,
    commitSha: string,
    entry: StatusDiffEntry
  ): Promise<Diff> {
    const change = this.changeTypeToDiffKind(entry.change);
    let oldPath: string | undefined;
    let newPath: string | undefined;

    if (entry.change === ChangeType.Added) { newPath = entry.path; }
    else if (entry.change === ChangeType.Deleted) { oldPath = entry.oldPath || entry.path; }
    else { oldPath = entry.oldPath || entry.path; newPath = entry.path; }

    const oldContent = oldPath ? await this.getOldContent(repoPath, `${commitSha}^`, oldPath) : undefined;
    const newContent = newPath ? await this.getOldContent(repoPath, commitSha, newPath) : undefined;

    let additions: number | undefined;
    let deletions: number | undefined;
    if (oldContent !== undefined && newContent !== undefined) {
      const counts = computeLineChangeCounts(oldContent, newContent);
      additions = counts.additions;
      deletions = counts.deletions;
    }

    return {
      change, oldPath, newPath, oldContent, newContent,
      contentOmitted: false, additions, deletions, repoId: undefined,
    };
  }

  private changeTypeToDiffKind(ct: ChangeType): DiffChangeKind {
    switch (ct) {
      case ChangeType.Added: return 'Added';
      case ChangeType.Deleted: return 'Deleted';
      case ChangeType.Modified: return 'Modified';
      case ChangeType.Renamed: return 'Renamed';
      case ChangeType.Copied: return 'Copied';
      case ChangeType.TypeChanged: return 'Modified';
      case ChangeType.Unmerged: return 'Modified';
      case ChangeType.Unknown: return 'Modified';
    }
  }

  private parseNameStatusOutput(output: string): StatusDiffEntry[] {
    const entries: StatusDiffEntry[] = [];
    for (const line of output.split('\n')) {
      const trimmed = line.trimEnd();
      if (trimmed.length === 0) continue;
      const parts = trimmed.split('\t');
      const code = parts[0] || '';
      const first = code.charAt(0);
      let change: ChangeType;
      switch (first) {
        case 'A': change = ChangeType.Added; break;
        case 'M': change = ChangeType.Modified; break;
        case 'D': change = ChangeType.Deleted; break;
        case 'R': change = ChangeType.Renamed; break;
        case 'C': change = ChangeType.Copied; break;
        case 'T': change = ChangeType.TypeChanged; break;
        case 'U': change = ChangeType.Unmerged; break;
        default: change = ChangeType.Unknown;
      }
      if ((change === ChangeType.Renamed || change === ChangeType.Copied)) {
        const oldP = parts[1];
        const newP = parts[2];
        if (oldP && newP) {
          entries.push({ change, path: newP, oldPath: oldP });
        }
      } else {
        const p = parts[1];
        if (p) {
          entries.push({ change, path: p, oldPath: undefined });
        }
      }
    }
    return entries;
  }
}

// Re-export additional cli types needed by consumers
export {
  ChangeType,
  type StatusDiffEntry,
  type StatusDiffOptions,
  type WorktreeEntry,
  type WorktreeStatus as WorktreeStatusType,
} from './cli.js';
