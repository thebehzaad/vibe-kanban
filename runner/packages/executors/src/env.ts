/**
 * Execution environment
 * Translates: crates/executors/src/env.rs
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { GitService } from '@runner/git';
import type { CmdOverrides } from './command.js';

// --- RepoContext ---

export class RepoContext {
  public readonly workspaceRoot: string;
  public readonly repoNames: string[];

  constructor(workspaceRoot: string = '', repoNames: string[] = []) {
    this.workspaceRoot = workspaceRoot;
    this.repoNames = repoNames;
  }

  repoPaths(): string[] {
    return this.repoNames.map((name) => path.join(this.workspaceRoot, name));
  }

  async checkUncommittedChanges(): Promise<string> {
    const repoPaths = this.repoPaths();
    if (repoPaths.length === 0) {
      return '';
    }

    const git = new GitService();
    let allStatus = '';

    for (const repoPath of repoPaths) {
      const gitDir = path.join(repoPath, '.git');
      if (!fs.existsSync(gitDir)) {
        continue;
      }

      try {
        const status = await git.getWorktreeStatus(repoPath);
        if (status.entries.length > 0) {
          let statusOutput = '';
          for (const entry of status.entries) {
            statusOutput += `${entry.staged}${entry.unstaged} ${entry.path}\n`;
          }
          allStatus += `\n${repoPath}:\n${statusOutput}`;
        }
      } catch {
        // Skip repos that fail
      }
    }

    return allStatus;
  }
}

// --- ExecutionEnv ---

export class ExecutionEnv {
  public vars: Record<string, string>;
  public repoContext: RepoContext;
  public commitReminder: boolean;
  public commitReminderPrompt: string;

  constructor(
    repoContext: RepoContext,
    commitReminder: boolean = false,
    commitReminderPrompt: string = '',
  ) {
    this.vars = {};
    this.repoContext = repoContext;
    this.commitReminder = commitReminder;
    this.commitReminderPrompt = commitReminderPrompt;
  }

  insert(key: string, value: string): void {
    this.vars[key] = value;
  }

  merge(other: Record<string, string>): void {
    Object.assign(this.vars, other);
  }

  withOverrides(overrides: Record<string, string>): this {
    this.merge(overrides);
    return this;
  }

  withProfile(cmd: CmdOverrides): this {
    if (cmd.env) {
      this.withOverrides(cmd.env);
    }
    return this;
  }

  applyToCommand(env: Record<string, string>): Record<string, string> {
    return { ...env, ...this.vars };
  }

  containsKey(key: string): boolean {
    return key in this.vars;
  }

  get(key: string): string | undefined {
    return this.vars[key];
  }
}
