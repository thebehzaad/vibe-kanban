/**
 * Git CLI operations
 * Translates: crates/git/src/cli.rs
 *
 * Why we prefer the Git CLI:
 * - Safer working-tree semantics: git CLI refuses to clobber uncommitted changes
 * - Sparse-checkout correctness: CLI natively respects sparse-checkout
 * - Cross-platform stability: More reliable than libgit2 in complex scenarios
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Directories to always exclude from git operations
 */
const ALWAYS_SKIP_DIRS = ['node_modules', '.git', 'dist', 'build'];


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
  pathFilter?: string[]; // pathspecs to limit diff
}

/**
 * Parsed entry from `git status --porcelain`
 */
export interface StatusEntry {
  /** Single-letter staged status (column X) or '?' for untracked */
  staged: string;
  /** Single-letter unstaged status (column Y) or '?' for untracked */
  unstaged: string;
  /** Current path */
  path: Buffer;
  /** Original path (for renames) */
  origPath?: Buffer;
  /** True if this entry is untracked ("??") */
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
  /**
   * Run `git -C <repo> worktree add <path> <branch>` (optionally creating the branch with -b)
   */
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

    // Good practice: reapply sparse-checkout in the new worktree
    try {
      await this.git(worktreePath, ['sparse-checkout', 'reapply']);
    } catch {
      // Non-fatal if it fails or not configured
    }
  }

  /**
   * Run `git -C <repo> worktree remove <path>`
   */
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

  /**
   * Run `git -C <repo> worktree move <old_path> <new_path>`
   */
  async worktreeMove(
    repoPath: string,
    oldPath: string,
    newPath: string
  ): Promise<void> {
    await this.ensureAvailable();
    await this.git(repoPath, ['worktree', 'move', oldPath, newPath]);
  }

  /**
   * Prune stale worktree metadata
   */
  async worktreePrune(repoPath: string): Promise<void> {
    await this.git(repoPath, ['worktree', 'prune']);
  }

  /**
   * Return true if there are any changes in the working tree (staged or unstaged).
   */
  async hasChanges(worktreePath: string): Promise<boolean> {
    const out = await this.git(worktreePath, ['--no-optional-locks', 'status', '--porcelain']);
    return out.trim().length > 0;
  }

  /**
   * Diff status vs a base branch using a temporary index (always includes untracked).
   * Path filter limits the reported paths.
   */
  async diffStatus(
    worktreePath: string,
    baseCommit: string,
    opts: StatusDiffOptions = {}
  ): Promise<StatusDiffEntry[]> {
    // Create a temp index file
    const tmpIndex = join(tmpdir(), `git-index-${Date.now()}`);
    const envs: Record<string, string> = {
      GIT_INDEX_FILE: tmpIndex
    };

    try {
      // Use a temp index from HEAD to accurately track renames in untracked files
      await this.gitWithEnv(worktreePath, ['read-tree', 'HEAD'], envs);

      // Stage changed and untracked files
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
        
        // Add files to temp index
        await this.gitWithStdin(
          worktreePath,
          ['--no-optional-locks', 'update-index', '--add', '--remove', '-z', '--stdin'],
          envs,
          Buffer.concat(allPaths.map(p => Buffer.from(p + '\0')))
        );
      }

      // Get diff with rename detection
      const diffArgs = [
        '--no-optional-locks',
        'diff-index',
        '--name-status',
        '--find-renames',
        '--find-copies',
        '-z',
        baseCommit
      ];

      const diffOut = await this.gitWithEnv(worktreePath, diffArgs, envs);
      return this.parseDiffStatus(diffOut);
    } finally {
      // Clean up temp index
      try {
        const fs = await import('fs/promises');
        await fs.unlink(tmpIndex);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Get detailed worktree status
   */
  async getWorktreeStatus(worktreePath: string): Promise<WorktreeStatus> {
    const out = await this.git(worktreePath, ['--no-optional-locks', 'status', '--porcelain', '-z']);
    
    const entries: StatusEntry[] = [];
    let uncommittedTracked = 0;
    let untracked = 0;

    if (out.length === 0) {
      return { uncommittedTracked, untracked, entries };
    }

    const parts = out.split('\0').filter(p => p.length > 0);
    let i = 0;

    while (i < parts.length) {
      const statusLine = parts[i];
      if (!statusLine || statusLine.length < 3) {
        i++;
        continue;
      }

      const staged = statusLine[0] || ' ';
      const unstaged = statusLine[1] || ' ';
      const isUntracked = statusLine === '??';
      
      i++;
      if (i >= parts.length) break;
      
      const path = parts[i];
      if (!path) {
        i++;
        continue;
      }
      let origPath: string | undefined;

      // Check for rename (R or C in first column)
      if (staged === 'R' || staged === 'C') {
        i++;
        if (i < parts.length) {
          origPath = parts[i];
        }
      }

      entries.push({
        staged,
        unstaged,
        path: Buffer.from(path),
        origPath: origPath ? Buffer.from(origPath) : undefined,
        isUntracked
      });

      if (isUntracked) {
        untracked++;
      } else {
        uncommittedTracked++;
      }

      i++;
    }

    return { uncommittedTracked, untracked, entries };
  }

  /**
   * List all worktrees
   */
  async listWorktrees(repoPath: string): Promise<WorktreeEntry[]> {
    const out = await this.git(repoPath, ['worktree', 'list', '--porcelain']);
    const worktrees: WorktreeEntry[] = [];
    
    let currentPath: string | undefined;
    let currentBranch: string | undefined;
    
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (currentPath) {
          worktrees.push({ path: currentPath, branch: currentBranch });
        }
        currentPath = line.substring(9);
        currentBranch = undefined;
      } else if (line.startsWith('branch ')) {
        currentBranch = line.substring(7);
      }
    }
    
    if (currentPath) {
      worktrees.push({ path: currentPath, branch: currentBranch });
    }
    
    return worktrees;
  }

  /**
   * List remotes
   */
  async listRemotes(repoPath: string): Promise<Array<[string, string]>> {
    const out = await this.git(repoPath, ['remote', '-v']);
    const remotes = new Map<string, string>();
    
    for (const line of out.split('\n')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const name = parts[0];
        const url = parts[1];
        if (name && url && !remotes.has(name)) {
          remotes.set(name, url);
        }
      }
    }
    
    return Array.from(remotes.entries());
  }

  /**
   * Stage files
   */
  async add(repoPath: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.git(repoPath, ['add', ...paths]);
  }

  /**
   * Commit changes
   */
  async commit(repoPath: string, message: string): Promise<void> {
    await this.ensureCliCommitIdentity(repoPath);
    await this.git(repoPath, ['commit', '-m', message]);
  }

  /**
   * Push to remote
   */
  async push(repoPath: string, remote: string, branch: string, force: boolean = false): Promise<void> {
    const args = ['push', remote, branch];
    if (force) {
      args.push('--force');
    }
    await this.git(repoPath, args);
  }

  /**
   * Fetch from remote
   */
  async fetch(repoPath: string, remote: string, refspec?: string): Promise<void> {
    const args = ['fetch', remote];
    if (refspec) {
      args.push(refspec);
    }
    await this.git(repoPath, args);
  }

  /**
   * Checkout branch or commit
   */
  async checkout(repoPath: string, ref: string): Promise<void> {
    await this.git(repoPath, ['checkout', ref]);
  }

  /**
   * Create a new branch
   */
  async createBranch(repoPath: string, branchName: string, startPoint?: string): Promise<void> {
    const args = ['branch', branchName];
    if (startPoint) {
      args.push(startPoint);
    }
    await this.git(repoPath, args);
  }

  /**
   * Delete a branch
   */
  async deleteBranch(repoPath: string, branchName: string, force: boolean = false): Promise<void> {
    const flag = force ? '-D' : '-d';
    await this.git(repoPath, ['branch', flag, branchName]);
  }

  /**
   * Merge a branch
   */
  async merge(repoPath: string, branch: string, noFf: boolean = false): Promise<void> {
    const args = ['merge', branch];
    if (noFf) {
      args.push('--no-ff');
    }
    await this.git(repoPath, args);
  }

  /**
   * Rebase onto a branch
   */
  async rebase(repoPath: string, upstream: string): Promise<void> {
    await this.git(repoPath, ['rebase', upstream]);
  }

  /**
   * Abort an in-progress rebase
   */
  async rebaseAbort(repoPath: string): Promise<void> {
    await this.git(repoPath, ['rebase', '--abort']);
  }

  /**
   * Continue a rebase after resolving conflicts
   */
  async rebaseContinue(repoPath: string): Promise<void> {
    await this.git(repoPath, ['rebase', '--continue']);
  }

  // Private helper methods

  private async ensureAvailable(): Promise<void> {
    try {
      await this.runCommand('git', ['--version']);
    } catch {
      throw GitCliError.notAvailable();
    }
  }

  private async ensureCliCommitIdentity(repoPath: string): Promise<void> {
    try {
      await this.git(repoPath, ['config', 'user.name']);
      await this.git(repoPath, ['config', 'user.email']);
    } catch {
      // Set default identity if missing
      await this.git(repoPath, ['config', 'user.name', 'Vibe Kanban']);
      await this.git(repoPath, ['config', 'user.email', 'noreply@vibekanban.com']);
    }
  }

  private async runCommand(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: 'pipe' });
      
      let stdout = '';
      let stderr = '';
      
      if (child.stdout) {
        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }
      
      if (child.stderr) {
        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }
      
      child.on('error', (error) => {
        reject(new Error(error.message));
      });
      
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `Command failed with code ${code}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

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

  private async gitImpl(
    repoPath: string,
    args: string[],
    envs: Record<string, string>,
    stdin?: Buffer
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', ['-C', repoPath, ...args], {
        env: { ...process.env, ...envs },
        stdio: stdin ? 'pipe' : 'inherit'
      });

      let stdout = '';
      let stderr = '';

      if (child.stdout) {
        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      if (stdin && child.stdin) {
        child.stdin.write(stdin);
        child.stdin.end();
      }

      child.on('error', (error) => {
        reject(GitCliError.commandFailed(error.message));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          const msg = stderr || stdout || `Command failed with code ${code}`;
          reject(this.classifyCliError(msg));
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

  private parseDiffStatus(output: string): StatusDiffEntry[] {
    const entries: StatusDiffEntry[] = [];
    const parts = output.split('\0').filter(p => p.length > 0);
    
    let i = 0;
    while (i < parts.length) {
      const statusCode = parts[i];
      if (!statusCode || statusCode.length === 0) {
        i++;
        continue;
      }

      const changeType = this.parseChangeType(statusCode[0] || 'X');
      i++;
      
      if (i >= parts.length) break;
      const path = parts[i];
      if (!path) {
        i++;
        continue;
      }
      let oldPath: string | undefined;

      // Handle renames and copies (two paths)
      if (statusCode[0] === 'R' || statusCode[0] === 'C') {
        i++;
        if (i < parts.length) {
          oldPath = path;
          const newPath = parts[i];
          if (newPath) {
            entries.push({ change: changeType, path: newPath, oldPath });
          }
        }
      } else {
        entries.push({ change: changeType, path, oldPath });
      }

      i++;
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

  private getDefaultPathspecExcludes(): string[] {
    return ALWAYS_SKIP_DIRS.map(d => `:(glob,exclude)**/${d}/`);
  }
}
