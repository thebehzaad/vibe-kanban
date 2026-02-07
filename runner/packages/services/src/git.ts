/**
 * Git service - Full implementation
 * Translates: crates/services/src/git.rs
 */

import { runCommand, type CommandResult } from '@runner/utils';

export interface GitConfig {
  repoPath: string;
}

export interface GitStatus {
  branch: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  authorEmail: string;
  date: Date;
}

export interface GitDiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitWorktree {
  path: string;
  head: string;
  branch: string;
  bare: boolean;
}

export interface GitFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked';
  oldPath?: string;
}

export class GitService {
  constructor(private config: GitConfig) {}

  private get cwd(): string {
    return this.config.repoPath;
  }

  private async git(args: string[]): Promise<CommandResult> {
    return runCommand('git', args, { cwd: this.cwd });
  }

  private async gitOk(args: string[]): Promise<string> {
    const result = await this.git(args);
    if (result.exitCode !== 0) {
      throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
    }
    return result.stdout.trim();
  }

  // ─── Status Operations ───────────────────────────────────────────

  async status(): Promise<GitStatus> {
    const branchResult = await this.git(['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : 'HEAD';

    const statusResult = await this.git(['status', '--porcelain', '-z']);
    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    if (statusResult.exitCode === 0 && statusResult.stdout) {
      const entries = statusResult.stdout.split('\0').filter(Boolean);
      for (const entry of entries) {
        const indexStatus = entry[0];
        const workStatus = entry[1];
        const file = entry.slice(3);

        if (indexStatus === '?') {
          untracked.push(file);
        } else {
          if (indexStatus !== ' ' && indexStatus !== '?') {
            staged.push(file);
          }
          if (workStatus !== ' ' && workStatus !== '?') {
            unstaged.push(file);
          }
        }
      }
    }

    let ahead = 0;
    let behind = 0;
    try {
      const aheadResult = await this.git(['rev-list', '--count', '@{upstream}..HEAD']);
      if (aheadResult.exitCode === 0) ahead = parseInt(aheadResult.stdout.trim()) || 0;
      const behindResult = await this.git(['rev-list', '--count', 'HEAD..@{upstream}']);
      if (behindResult.exitCode === 0) behind = parseInt(behindResult.stdout.trim()) || 0;
    } catch {
      // No upstream configured
    }

    return { branch, staged, unstaged, untracked, ahead, behind };
  }

  async isClean(): Promise<boolean> {
    const result = await this.git(['status', '--porcelain']);
    return result.exitCode === 0 && result.stdout.trim() === '';
  }

  async hasUncommittedChanges(): Promise<boolean> {
    return !(await this.isClean());
  }

  async untrackedFiles(): Promise<string[]> {
    const result = await this.git(['ls-files', '--others', '--exclude-standard']);
    if (result.exitCode !== 0) return [];
    return result.stdout.trim().split('\n').filter(Boolean);
  }

  // ─── Branch Operations ───────────────────────────────────────────

  async createBranch(name: string, startPoint?: string): Promise<void> {
    const args = ['branch', name];
    if (startPoint) args.push(startPoint);
    await this.gitOk(args);
  }

  async checkout(branch: string): Promise<void> {
    await this.gitOk(['checkout', branch]);
  }

  async checkoutNewBranch(name: string, startPoint?: string): Promise<void> {
    const args = ['checkout', '-b', name];
    if (startPoint) args.push(startPoint);
    await this.gitOk(args);
  }

  async deleteBranch(name: string, force = false): Promise<void> {
    await this.gitOk(['branch', force ? '-D' : '-d', name]);
  }

  async deleteRemoteBranch(remote: string, branch: string): Promise<void> {
    await this.gitOk(['push', remote, '--delete', branch]);
  }

  async listBranches(all = false): Promise<string[]> {
    const args = ['branch', '--format=%(refname:short)'];
    if (all) args.push('-a');
    const output = await this.gitOk(args);
    return output.split('\n').filter(Boolean);
  }

  async currentBranch(): Promise<string> {
    return this.gitOk(['rev-parse', '--abbrev-ref', 'HEAD']);
  }

  async setUpstream(branch: string, remote: string = 'origin'): Promise<void> {
    await this.gitOk(['branch', '--set-upstream-to', `${remote}/${branch}`, branch]);
  }

  // ─── Commit Operations ───────────────────────────────────────────

  async commit(message: string, options?: { allowEmpty?: boolean; amend?: boolean }): Promise<GitCommit> {
    const args = ['commit', '-m', message];
    if (options?.allowEmpty) args.push('--allow-empty');
    if (options?.amend) args.push('--amend');
    await this.gitOk(args);
    return this.showHead();
  }

  async amend(message?: string): Promise<GitCommit> {
    const args = ['commit', '--amend'];
    if (message) {
      args.push('-m', message);
    } else {
      args.push('--no-edit');
    }
    await this.gitOk(args);
    return this.showHead();
  }

  async reset(ref: string, mode: 'soft' | 'mixed' | 'hard' = 'mixed'): Promise<void> {
    await this.gitOk(['reset', `--${mode}`, ref]);
  }

  async log(maxCount: number = 20, ref?: string): Promise<GitCommit[]> {
    const format = '%H%n%h%n%s%n%an%n%ae%n%aI%n---';
    const args = ['log', `--format=${format}`, `-n`, String(maxCount)];
    if (ref) args.push(ref);
    const output = await this.gitOk(args);

    const commits: GitCommit[] = [];
    const blocks = output.split('---\n').filter(Boolean);
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length >= 6) {
        commits.push({
          hash: lines[0]!,
          shortHash: lines[1]!,
          message: lines[2]!,
          author: lines[3]!,
          authorEmail: lines[4]!,
          date: new Date(lines[5]!),
        });
      }
    }
    return commits;
  }

  async show(ref: string = 'HEAD'): Promise<GitCommit> {
    const format = '%H%n%h%n%s%n%an%n%ae%n%aI';
    const output = await this.gitOk(['show', '-s', `--format=${format}`, ref]);
    const lines = output.split('\n');
    return {
      hash: lines[0] ?? '',
      shortHash: lines[1] ?? '',
      message: lines[2] ?? '',
      author: lines[3] ?? '',
      authorEmail: lines[4] ?? '',
      date: new Date(lines[5] ?? ''),
    };
  }

  async showHead(): Promise<GitCommit> {
    return this.show('HEAD');
  }

  async addAll(): Promise<void> {
    await this.gitOk(['add', '-A']);
  }

  async add(files: string[]): Promise<void> {
    await this.gitOk(['add', ...files]);
  }

  // ─── Remote Operations ───────────────────────────────────────────

  async fetch(remote: string = 'origin', branch?: string): Promise<void> {
    const args = ['fetch', remote];
    if (branch) args.push(branch);
    await this.gitOk(args);
  }

  async pull(remote: string = 'origin', branch?: string): Promise<void> {
    const args = ['pull', remote];
    if (branch) args.push(branch);
    await this.gitOk(args);
  }

  async push(remote: string = 'origin', branch?: string, options?: { force?: boolean; setUpstream?: boolean }): Promise<void> {
    const args = ['push'];
    if (options?.force) args.push('--force-with-lease');
    if (options?.setUpstream) args.push('-u');
    args.push(remote);
    if (branch) args.push(branch);
    await this.gitOk(args);
  }

  async addRemote(name: string, url: string): Promise<void> {
    await this.gitOk(['remote', 'add', name, url]);
  }

  async listRemotes(): Promise<GitRemote[]> {
    const output = await this.gitOk(['remote', '-v']);
    const remotes = new Map<string, GitRemote>();

    for (const line of output.split('\n').filter(Boolean)) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
      if (match) {
        const name = match[1]!;
        const url = match[2]!;
        const type = match[3]!;
        if (!remotes.has(name)) {
          remotes.set(name, { name, fetchUrl: '', pushUrl: '' });
        }
        const remote = remotes.get(name)!;
        if (type === 'fetch') remote.fetchUrl = url;
        else remote.pushUrl = url;
      }
    }

    return [...remotes.values()];
  }

  async getRemoteUrl(remote: string = 'origin'): Promise<string | undefined> {
    const result = await this.git(['remote', 'get-url', remote]);
    return result.exitCode === 0 ? result.stdout.trim() : undefined;
  }

  // ─── Diff Operations ─────────────────────────────────────────────

  async diff(from?: string, to?: string): Promise<string> {
    const args = ['diff'];
    if (from) args.push(from);
    if (to) args.push(to);
    return this.gitOk(args);
  }

  async diffStaged(): Promise<string> {
    return this.gitOk(['diff', '--cached']);
  }

  async diffStats(from?: string, to?: string): Promise<GitDiffStat> {
    const args = ['diff', '--numstat'];
    if (from) args.push(from);
    if (to) args.push(to);
    const output = await this.gitOk(args);

    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;

    for (const line of output.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        filesChanged++;
        const added = parseInt(parts[0] ?? '0');
        const removed = parseInt(parts[1] ?? '0');
        if (!isNaN(added)) insertions += added;
        if (!isNaN(removed)) deletions += removed;
      }
    }

    return { filesChanged, insertions, deletions };
  }

  async diffFiles(from?: string, to?: string): Promise<GitFileChange[]> {
    const args = ['diff', '--name-status'];
    if (from) args.push(from);
    if (to) args.push(to);
    const output = await this.gitOk(args);

    const changes: GitFileChange[] = [];
    for (const line of output.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length < 2) continue;
      const statusChar = parts[0]![0];
      const filePath = parts[1]!;
      const oldPath = parts.length > 2 ? parts[2] : undefined;

      let status: GitFileChange['status'];
      switch (statusChar) {
        case 'A': status = 'added'; break;
        case 'M': status = 'modified'; break;
        case 'D': status = 'deleted'; break;
        case 'R': status = 'renamed'; break;
        case 'C': status = 'copied'; break;
        default: status = 'modified';
      }

      changes.push({ path: filePath, status, oldPath });
    }

    return changes;
  }

  async stagedFiles(): Promise<string[]> {
    const result = await this.git(['diff', '--cached', '--name-only']);
    if (result.exitCode !== 0) return [];
    return result.stdout.trim().split('\n').filter(Boolean);
  }

  async unstagedFiles(): Promise<string[]> {
    const result = await this.git(['diff', '--name-only']);
    if (result.exitCode !== 0) return [];
    return result.stdout.trim().split('\n').filter(Boolean);
  }

  // ─── Merge Operations ────────────────────────────────────────────

  async merge(branch: string, options?: { noFf?: boolean; message?: string }): Promise<void> {
    const args = ['merge'];
    if (options?.noFf) args.push('--no-ff');
    if (options?.message) args.push('-m', options.message);
    args.push(branch);
    await this.gitOk(args);
  }

  async mergeBase(ref1: string, ref2: string): Promise<string> {
    return this.gitOk(['merge-base', ref1, ref2]);
  }

  async hasMergeConflicts(): Promise<boolean> {
    const result = await this.git(['diff', '--name-only', '--diff-filter=U']);
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  }

  async abortMerge(): Promise<void> {
    await this.gitOk(['merge', '--abort']);
  }

  // ─── Advanced Operations ─────────────────────────────────────────

  async cherryPick(commitHash: string): Promise<void> {
    await this.gitOk(['cherry-pick', commitHash]);
  }

  async rebase(onto: string): Promise<void> {
    await this.gitOk(['rebase', onto]);
  }

  async abortRebase(): Promise<void> {
    await this.gitOk(['rebase', '--abort']);
  }

  async stash(message?: string): Promise<void> {
    const args = ['stash', 'push'];
    if (message) args.push('-m', message);
    await this.gitOk(args);
  }

  async applyStash(index: number = 0): Promise<void> {
    await this.gitOk(['stash', 'apply', `stash@{${index}}`]);
  }

  async popStash(index: number = 0): Promise<void> {
    await this.gitOk(['stash', 'pop', `stash@{${index}}`]);
  }

  async tag(name: string, message?: string, ref?: string): Promise<void> {
    const args = ['tag'];
    if (message) args.push('-a', name, '-m', message);
    else args.push(name);
    if (ref) args.push(ref);
    await this.gitOk(args);
  }

  async describe(ref?: string): Promise<string | undefined> {
    const args = ['describe', '--tags', '--always'];
    if (ref) args.push(ref);
    const result = await this.git(args);
    return result.exitCode === 0 ? result.stdout.trim() : undefined;
  }

  // ─── Worktree Management ─────────────────────────────────────────

  async addWorktree(worktreePath: string, branch: string, options?: { newBranch?: boolean; force?: boolean }): Promise<void> {
    const args = ['worktree', 'add'];
    if (options?.force) args.push('--force');
    if (options?.newBranch) {
      args.push('-b', branch, worktreePath);
    } else {
      args.push(worktreePath, branch);
    }
    await this.gitOk(args);
  }

  async removeWorktree(worktreePath: string, force = false): Promise<void> {
    const args = ['worktree', 'remove'];
    if (force) args.push('--force');
    args.push(worktreePath);
    await this.gitOk(args);
  }

  async pruneWorktrees(): Promise<void> {
    await this.gitOk(['worktree', 'prune']);
  }

  async listWorktrees(): Promise<GitWorktree[]> {
    const output = await this.gitOk(['worktree', 'list', '--porcelain']);
    const worktrees: GitWorktree[] = [];
    let current: Partial<GitWorktree> = {};

    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) worktrees.push(current as GitWorktree);
        current = { path: line.slice(9), head: '', branch: '', bare: false };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).replace('refs/heads/', '');
      } else if (line === 'bare') {
        current.bare = true;
      }
    }
    if (current.path) worktrees.push(current as GitWorktree);

    return worktrees;
  }

  // ─── Config & Info ────────────────────────────────────────────────

  async configGet(key: string): Promise<string | undefined> {
    const result = await this.git(['config', '--get', key]);
    return result.exitCode === 0 ? result.stdout.trim() : undefined;
  }

  async configSet(key: string, value: string): Promise<void> {
    await this.gitOk(['config', key, value]);
  }

  async getRepoRoot(): Promise<string> {
    return this.gitOk(['rev-parse', '--show-toplevel']);
  }

  async revParse(ref: string): Promise<string> {
    return this.gitOk(['rev-parse', ref]);
  }

  async getDefaultBranch(): Promise<string> {
    const result = await this.git(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short']);
    if (result.exitCode === 0) {
      return result.stdout.trim().replace('origin/', '');
    }
    const mainResult = await this.git(['rev-parse', '--verify', 'main']);
    return mainResult.exitCode === 0 ? 'main' : 'master';
  }

  // ─── Submodules & LFS ────────────────────────────────────────────

  async initSubmodules(): Promise<void> {
    await this.gitOk(['submodule', 'init']);
  }

  async updateSubmodules(recursive = true): Promise<void> {
    const args = ['submodule', 'update', '--init'];
    if (recursive) args.push('--recursive');
    await this.gitOk(args);
  }

  async lfsPull(): Promise<void> {
    await this.gitOk(['lfs', 'pull']);
  }

  async lfsFetch(ref?: string): Promise<void> {
    const args = ['lfs', 'fetch'];
    if (ref) args.push('origin', ref);
    await this.gitOk(args);
  }

  // ─── Utility Methods ─────────────────────────────────────────────

  async hasCommitsSince(ref: string): Promise<boolean> {
    const result = await this.git(['rev-list', '--count', `${ref}..HEAD`]);
    return result.exitCode === 0 && parseInt(result.stdout.trim()) > 0;
  }

  async getChangedFilesSince(ref: string): Promise<string[]> {
    const result = await this.git(['diff', '--name-only', ref, 'HEAD']);
    if (result.exitCode !== 0) return [];
    return result.stdout.trim().split('\n').filter(Boolean);
  }

  async autoCommit(message: string): Promise<GitCommit | null> {
    const clean = await this.isClean();
    if (clean) return null;

    await this.addAll();
    return this.commit(message);
  }
}
