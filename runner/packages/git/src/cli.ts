/**
 * Git CLI operations
 * Translates: crates/git/src/cli.rs
 *
 * Why we prefer the Git CLI:
 * - Safer working-tree semantics: git CLI refuses to clobber uncommitted changes
 * - Sparse-checkout correctness: CLI natively respects sparse-checkout
 * - Cross-platform stability: More reliable than libgit2 in complex scenarios
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALWAYS_SKIP_DIRS, resolveExecutablePathBlocking } from '@runner/utils';

export class GitCliError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'GitCliError';
  }

  static notAvailable(): GitCliError {
    return new GitCliError('git executable not found or not runnable', 'NOT_AVAILABLE');
  }

  static commandFailed(message: string): GitCliError {
    return new GitCliError(`git command failed: ${message}`, 'COMMAND_FAILED');
  }

  static authFailed(message: string): GitCliError {
    return new GitCliError(`authentication failed: ${message}`, 'AUTH_FAILED');
  }

  static pushRejected(message: string): GitCliError {
    return new GitCliError(`push rejected: ${message}`, 'PUSH_REJECTED');
  }

  static rebaseInProgress(): GitCliError {
    return new GitCliError('rebase in progress in this worktree', 'REBASE_IN_PROGRESS');
  }
}

/**
 * Parsed change type from `git diff --name-status` output
 */
export enum ChangeType {
  Added = 'Added',
  Modified = 'Modified',
  Deleted = 'Deleted',
  Renamed = 'Renamed',
  Copied = 'Copied',
  TypeChanged = 'TypeChanged',
  Unmerged = 'Unmerged',
  Unknown = 'Unknown'
}

/**
 * One entry from a status diff (name-status + paths)
 */
export interface StatusDiffEntry {
  change: ChangeType;
  path: string;
  oldPath?: string;
}

/**
 * Parsed worktree entry from `git worktree list --porcelain`
 */
export interface WorktreeEntry {
  path: string;
  branch?: string;
}

export interface StatusDiffOptions {
  pathFilter?: string[];
}

/**
 * Parsed entry from `git status --porcelain`
 */
export interface StatusEntry {
  staged: string;
  unstaged: string;
  path: Buffer;
  origPath?: Buffer;
  isUntracked: boolean;
}

/**
 * Summary + entries for a working tree status
 */
export interface WorktreeStatus {
  uncommittedTracked: number;
  untracked: number;
  entries: StatusEntry[];
}

export class GitCli {
  // ── Worktree operations ──

  async worktreeAdd(
    repoPath: string,
    worktreePath: string,
    branch: string,
    createBranch: boolean = false
  ): Promise<void> {
    await this.ensureAvailable();

    const args: string[] = ['worktree', 'add'];
    if (createBranch) {
      args.push('-b', branch);
    }
    args.push(worktreePath, branch);
    await this.git(repoPath, args);

    try {
      await this.git(worktreePath, ['sparse-checkout', 'reapply']);
    } catch {
      // Non-fatal
    }
  }

  async worktreeRemove(
    repoPath: string,
    worktreePath: string,
    force: boolean = false
  ): Promise<void> {
    await this.ensureAvailable();
    const args: string[] = ['worktree', 'remove'];
    if (force) {
      args.push('--force');
    }
    args.push(worktreePath);
    await this.git(repoPath, args);
  }

  async worktreeMove(
    repoPath: string,
    oldPath: string,
    newPath: string
  ): Promise<void> {
    await this.ensureAvailable();
    await this.git(repoPath, ['worktree', 'move', oldPath, newPath]);
  }

  async worktreePrune(repoPath: string): Promise<void> {
    await this.git(repoPath, ['worktree', 'prune']);
  }

  // ── Status / diff operations ──

  async hasChanges(worktreePath: string): Promise<boolean> {
    const out = await this.git(worktreePath, ['--no-optional-locks', 'status', '--porcelain']);
    return out.trim().length > 0;
  }

  async diffStatus(
    worktreePath: string,
    baseCommit: string,
    opts: StatusDiffOptions = {}
  ): Promise<StatusDiffEntry[]> {
    const tmpIndex = join(tmpdir(), `git-index-${Date.now()}`);
    const envs: Record<string, string> = { GIT_INDEX_FILE: tmpIndex };

    try {
      await this.gitWithEnv(worktreePath, ['read-tree', 'HEAD'], envs);

      const status = await this.getWorktreeStatus(worktreePath);
      const pathsToAdd: Buffer[] = [];
      for (const entry of status.entries) {
        pathsToAdd.push(entry.path);
        if (entry.origPath) {
          pathsToAdd.push(entry.origPath);
        }
      }

      if (pathsToAdd.length > 0) {
        const excludes = this.getDefaultPathspecExcludes();
        const allPaths = [...pathsToAdd.map(p => p.toString()), ...excludes];
        const stdinBuf = Buffer.concat(allPaths.map(p => Buffer.from(p + '\0')));

        await this.gitWithStdin(
          worktreePath,
          ['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'],
          envs,
          stdinBuf
        );
      }

      // git diff --cached with rename detection
      let diffArgs = [
        '-c', 'core.quotepath=false',
        'diff', '--cached', '-M', '--name-status',
        baseCommit,
      ];
      diffArgs = this.applyPathspecFilter(diffArgs, opts.pathFilter);
      const out = await this.gitWithEnv(worktreePath, diffArgs, envs);
      return this.parseNameStatus(out);
    } finally {
      try {
        const fs = await import('node:fs/promises');
        await fs.unlink(tmpIndex);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  async getWorktreeStatus(worktreePath: string): Promise<WorktreeStatus> {
    const args = this.applyDefaultExcludes([
      '--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=normal'
    ]);
    const out = await this.git(worktreePath, args);

    const entries: StatusEntry[] = [];
    let uncommittedTracked = 0;
    let untracked = 0;

    if (out.length === 0) {
      return { uncommittedTracked, untracked, entries };
    }

    const parts = out.split('\0');
    let i = 0;

    while (i < parts.length) {
      const part = parts[i];
      if (!part || part.length < 4) {
        i++;
        continue;
      }

      const staged = part[0] || ' ';
      const unstaged = part[1] || ' ';
      const path = part.slice(3);

      let origPath: string | undefined;
      if ((staged === 'R' || unstaged === 'R' || staged === 'C' || unstaged === 'C')) {
        i++;
        const origPart = parts[i];
        if (i < parts.length && origPart && origPart.length > 0) {
          origPath = origPart;
        }
      }

      const isUntracked = staged === '?' && unstaged === '?';
      entries.push({
        staged,
        unstaged,
        path: Buffer.from(path),
        origPath: origPath ? Buffer.from(origPath) : undefined,
        isUntracked,
      });

      if (isUntracked) {
        untracked++;
      } else if (staged !== ' ' || unstaged !== ' ') {
        uncommittedTracked++;
      }

      i++;
    }

    return { uncommittedTracked, untracked, entries };
  }

  // ── Staging / commit ──

  async addAll(worktreePath: string): Promise<void> {
    await this.git(worktreePath, this.applyDefaultExcludes(['add', '-A']));
  }

  async commit(worktreePath: string, message: string): Promise<void> {
    await this.git(worktreePath, ['commit', '-m', message]);
  }

  async hasStagedChanges(repoPath: string): Promise<boolean> {
    const gitExe = resolveExecutablePathBlocking('git');
    if (!gitExe) throw GitCliError.notAvailable();

    return new Promise((resolve, reject) => {
      const child = spawn(gitExe, ['-C', repoPath, 'diff', '--cached', '--quiet'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stderr = '';
      if (child.stderr) child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('error', e => reject(GitCliError.commandFailed(e.message)));
      child.on('close', code => {
        if (code === 0) resolve(false);
        else if (code === 1) resolve(true);
        else reject(GitCliError.commandFailed(stderr.trim()));
      });
    });
  }

  // ── Worktree listing ──

  async listWorktrees(repoPath: string): Promise<WorktreeEntry[]> {
    const out = await this.git(repoPath, ['worktree', 'list', '--porcelain']);
    const entries: WorktreeEntry[] = [];

    let currentPath: string | undefined;
    let currentHead: string | undefined;
    let currentBranch: string | undefined;

    for (const line of out.split('\n')) {
      const trimmed = line.trim();

      if (trimmed.length === 0) {
        if (currentPath && currentHead) {
          entries.push({ path: currentPath, branch: currentBranch });
        }
        currentPath = undefined;
        currentHead = undefined;
        currentBranch = undefined;
      } else if (trimmed.startsWith('worktree ')) {
        currentPath = trimmed.substring(9);
      } else if (trimmed.startsWith('HEAD ')) {
        currentHead = trimmed.substring(5);
      } else if (trimmed.startsWith('branch ')) {
        const branchRef = trimmed.substring(7);
        currentBranch = branchRef.startsWith('refs/heads/')
          ? branchRef.substring(11)
          : branchRef;
      }
    }

    // Handle last entry if no trailing empty line
    if (currentPath && currentHead) {
      entries.push({ path: currentPath, branch: currentBranch });
    }

    return entries;
  }

  // ── Remote operations ──

  async listRemotes(repoPath: string): Promise<Array<[string, string]>> {
    const out = await this.git(repoPath, ['remote', '-v']);
    const seen = new Set<string>();
    const remotes: Array<[string, string]> = [];

    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const parts = trimmed.split('\t');
      if (parts.length >= 2) {
        const name = parts[0];
        const rawUrl = parts[1];
        if (!name || !rawUrl) continue;
        // Remove " (fetch)" or " (push)" suffix
        const url = rawUrl.replace(/ \((fetch|push)\)$/, '');
        if (name && url && !seen.has(name)) {
          seen.add(name);
          remotes.push([name, url]);
        }
      }
    }

    return remotes;
  }

  async getRemoteUrl(repoPath: string, remoteName: string): Promise<string> {
    const output = await this.git(repoPath, ['remote', 'get-url', remoteName]);
    return output.trim();
  }

  async fetchWithRefspec(
    repoPath: string,
    remoteUrl: string,
    refspec: string
  ): Promise<void> {
    const envs: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' };
    try {
      await this.gitWithEnv(repoPath, ['fetch', remoteUrl, refspec], envs);
    } catch (err) {
      if (err instanceof GitCliError) {
        throw this.classifyCliError(err.message);
      }
      throw err;
    }
  }

  async push(
    repoPath: string,
    remoteUrl: string,
    branch: string,
    force: boolean = false
  ): Promise<void> {
    const refspec = force
      ? `+refs/heads/${branch}:refs/heads/${branch}`
      : `refs/heads/${branch}:refs/heads/${branch}`;
    const envs: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' };
    try {
      await this.gitWithEnv(repoPath, ['push', remoteUrl, refspec], envs);
    } catch (err) {
      if (err instanceof GitCliError) {
        throw this.classifyCliError(err.message);
      }
      throw err;
    }
  }

  async checkRemoteBranchExists(
    repoPath: string,
    remoteUrl: string,
    branchName: string
  ): Promise<boolean> {
    const envs: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' };
    try {
      const output = await this.gitWithEnv(
        repoPath,
        ['ls-remote', '--heads', remoteUrl, `refs/heads/${branchName}`],
        envs
      );
      return output.trim().length > 0;
    } catch (err) {
      if (err instanceof GitCliError) {
        throw this.classifyCliError(err.message);
      }
      throw err;
    }
  }

  // ── Branch operations ──

  async checkout(repoPath: string, ref: string): Promise<void> {
    await this.git(repoPath, ['checkout', ref]);
  }

  async createBranch(repoPath: string, branchName: string, startPoint?: string): Promise<void> {
    const args = ['branch', branchName];
    if (startPoint) args.push(startPoint);
    await this.git(repoPath, args);
  }

  async deleteBranch(repoPath: string, branchName: string, force: boolean = false): Promise<void> {
    const flag = force ? '-D' : '-d';
    await this.git(repoPath, ['branch', flag, branchName]);
  }

  async merge(repoPath: string, branch: string, noFf: boolean = false): Promise<void> {
    const args = ['merge', branch];
    if (noFf) args.push('--no-ff');
    await this.git(repoPath, args);
  }

  // ── Merge-base / rebase ──

  async mergeBase(worktreePath: string, a: string, b: string): Promise<string> {
    try {
      const out = await this.git(worktreePath, ['merge-base', '--fork-point', a, b]);
      return out.trim();
    } catch {
      const out = await this.git(worktreePath, ['merge-base', a, b]);
      return out.trim();
    }
  }

  async rebaseOnto(
    worktreePath: string,
    newBase: string,
    oldBase: string,
    taskBranch: string
  ): Promise<void> {
    if (await this.isRebaseInProgress(worktreePath)) {
      throw GitCliError.rebaseInProgress();
    }

    let mergeBaseOid: string;
    try {
      mergeBaseOid = await this.mergeBase(worktreePath, oldBase, taskBranch);
    } catch {
      mergeBaseOid = oldBase;
    }

    await this.git(worktreePath, ['rebase', '--onto', newBase, mergeBaseOid, taskBranch]);
  }

  // ── Conflict detection ──

  async isRebaseInProgress(worktreePath: string): Promise<boolean> {
    const rebaseMerge = await this.git(worktreePath, ['rev-parse', '--git-path', 'rebase-merge']);
    const rebaseApply = await this.git(worktreePath, ['rev-parse', '--git-path', 'rebase-apply']);
    return existsSync(rebaseMerge.trim()) || existsSync(rebaseApply.trim());
  }

  async isMergeInProgress(worktreePath: string): Promise<boolean> {
    try {
      await this.git(worktreePath, ['rev-parse', '--verify', 'MERGE_HEAD']);
      return true;
    } catch (err) {
      if (err instanceof GitCliError && err.code === 'COMMAND_FAILED') return false;
      throw err;
    }
  }

  async isCherryPickInProgress(worktreePath: string): Promise<boolean> {
    try {
      await this.git(worktreePath, ['rev-parse', '--verify', 'CHERRY_PICK_HEAD']);
      return true;
    } catch (err) {
      if (err instanceof GitCliError && err.code === 'COMMAND_FAILED') return false;
      throw err;
    }
  }

  async isRevertInProgress(worktreePath: string): Promise<boolean> {
    try {
      await this.git(worktreePath, ['rev-parse', '--verify', 'REVERT_HEAD']);
      return true;
    } catch (err) {
      if (err instanceof GitCliError && err.code === 'COMMAND_FAILED') return false;
      throw err;
    }
  }

  // ── Conflict resolution ──

  async abortRebase(worktreePath: string): Promise<void> {
    if (!(await this.isRebaseInProgress(worktreePath))) return;
    await this.git(worktreePath, ['rebase', '--abort']);
  }

  async quitRebase(worktreePath: string): Promise<void> {
    if (!(await this.isRebaseInProgress(worktreePath))) return;
    await this.git(worktreePath, ['rebase', '--quit']);
  }

  async continueRebase(worktreePath: string): Promise<void> {
    if (!(await this.isRebaseInProgress(worktreePath))) {
      throw GitCliError.commandFailed('No rebase in progress');
    }
    await this.git(worktreePath, ['rebase', '--continue']);
  }

  async abortMerge(worktreePath: string): Promise<void> {
    if (!(await this.isMergeInProgress(worktreePath))) return;
    await this.git(worktreePath, ['merge', '--abort']);
  }

  async abortCherryPick(worktreePath: string): Promise<void> {
    if (!(await this.isCherryPickInProgress(worktreePath))) return;
    await this.git(worktreePath, ['cherry-pick', '--abort']);
  }

  async abortRevert(worktreePath: string): Promise<void> {
    if (!(await this.isRevertInProgress(worktreePath))) return;
    await this.git(worktreePath, ['revert', '--abort']);
  }

  async getConflictedFiles(worktreePath: string): Promise<string[]> {
    const out = await this.git(worktreePath, ['diff', '--name-only', '--diff-filter=U']);
    return out.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  }

  // ── Squash merge / ref update ──

  async mergeSquashCommit(
    repoPath: string,
    baseBranch: string,
    fromBranch: string,
    message: string
  ): Promise<string> {
    await this.git(repoPath, ['checkout', baseBranch]);
    await this.git(repoPath, ['merge', '--squash', '--no-commit', fromBranch]);
    await this.git(repoPath, ['commit', '-m', message]);
    const sha = await this.git(repoPath, ['rev-parse', 'HEAD']);
    return sha.trim();
  }

  async updateRef(repoPath: string, refname: string, sha: string): Promise<void> {
    await this.git(repoPath, ['update-ref', refname, sha]);
  }

  // ── Low-level runners ──

  async git(repoPath: string, args: string[]): Promise<string> {
    return this.gitImpl(repoPath, args, {}, undefined);
  }

  async gitWithEnv(
    repoPath: string,
    args: string[],
    envs: Record<string, string>
  ): Promise<string> {
    return this.gitImpl(repoPath, args, envs, undefined);
  }

  async gitWithStdin(
    repoPath: string,
    args: string[],
    envs: Record<string, string>,
    stdin: Buffer
  ): Promise<string> {
    return this.gitImpl(repoPath, args, envs, stdin);
  }

  // ── Private methods ──

  private async ensureAvailable(): Promise<void> {
    const gitExe = resolveExecutablePathBlocking('git');
    if (!gitExe) throw GitCliError.notAvailable();
    try {
      await this.runCommand(gitExe, ['--version']);
    } catch {
      throw GitCliError.notAvailable();
    }
  }

  private async runCommand(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      if (child.stdout) child.stdout.on('data', d => { stdout += d.toString(); });
      if (child.stderr) child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('error', e => reject(new Error(e.message)));
      child.on('close', code => {
        if (code !== 0) reject(new Error(stderr || `Command failed with code ${code}`));
        else resolve(stdout);
      });
    });
  }

  private async gitImpl(
    repoPath: string,
    args: string[],
    envs: Record<string, string>,
    stdin?: Buffer
  ): Promise<string> {
    const gitExe = resolveExecutablePathBlocking('git');
    if (!gitExe) throw GitCliError.notAvailable();

    return new Promise((resolve, reject) => {
      const child = spawn(gitExe, ['-C', repoPath, ...args], {
        env: { ...process.env, ...envs },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      if (child.stdout) child.stdout.on('data', d => { stdout += d.toString(); });
      if (child.stderr) child.stderr.on('data', d => { stderr += d.toString(); });

      if (stdin && child.stdin) {
        child.stdin.write(stdin);
        child.stdin.end();
      } else if (child.stdin) {
        child.stdin.end();
      }

      child.on('error', e => reject(GitCliError.commandFailed(e.message)));
      child.on('close', code => {
        if (code !== 0) {
          const combined = stderr || stdout || `Command failed with code ${code}`;
          reject(this.classifyCliError(combined));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  private classifyCliError(msg: string): GitCliError {
    const lower = msg.toLowerCase();
    if (lower.includes('authentication failed') ||
        lower.includes('could not read username') ||
        lower.includes('invalid username or password')) {
      return GitCliError.authFailed(msg);
    }
    if (lower.includes('non-fast-forward') ||
        lower.includes('failed to push some refs') ||
        lower.includes('fetch first') ||
        lower.includes('updates were rejected because the tip')) {
      return GitCliError.pushRejected(msg);
    }
    return GitCliError.commandFailed(msg);
  }

  private parseNameStatus(output: string): StatusDiffEntry[] {
    const entries: StatusDiffEntry[] = [];
    for (const line of output.split('\n')) {
      const trimmed = line.trimEnd();
      if (trimmed.length === 0) continue;

      const parts = trimmed.split('\t');
      const code = parts[0] || '';
      const change = this.parseChangeType(code.charAt(0));

      if (change === ChangeType.Renamed || change === ChangeType.Copied) {
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

  private parseChangeType(code: string): ChangeType {
    switch (code) {
      case 'A': return ChangeType.Added;
      case 'M': return ChangeType.Modified;
      case 'D': return ChangeType.Deleted;
      case 'R': return ChangeType.Renamed;
      case 'C': return ChangeType.Copied;
      case 'T': return ChangeType.TypeChanged;
      case 'U': return ChangeType.Unmerged;
      default: return ChangeType.Unknown;
    }
  }

  private applyDefaultExcludes(args: string[]): string[] {
    return this.applyPathspecFilter(args, undefined);
  }

  private applyPathspecFilter(args: string[], pathspecs?: string[]): string[] {
    const filters = this.buildPathspecFilter(pathspecs);
    if (filters.length > 0) {
      return [...args, '--', ...filters];
    }
    return args;
  }

  private buildPathspecFilter(pathspecs?: string[]): string[] {
    const filters: string[] = [];
    filters.push(...this.getDefaultPathspecExcludes());
    if (pathspecs) {
      for (const p of pathspecs) {
        if (p.trim().length > 0) {
          filters.push(p);
        }
      }
    }
    return filters;
  }

  private getDefaultPathspecExcludes(): string[] {
    return ALWAYS_SKIP_DIRS.map(d => `:(glob,exclude)**/${d}/`);
  }
}
