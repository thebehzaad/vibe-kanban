/**
 * Git utilities
 * Translates: crates/utils/src/git.rs and related git functionality
 */

import { runCommand } from './shell.js';

/**
 * Check if a branch name is valid according to git rules
 */
export function isValidBranchName(name: string): boolean {
  // Git branch name validation
  const invalidPatterns = [
    /^\./, // starts with .
    /\.\.$/, // ends with ..
    /[\x00-\x1f\x7f~^:?*\[\\]/, // invalid characters
    /@\{/, // @{ sequence
    /\/\//, // double slash
    /\.$/, // ends with .
    /\.lock$/, // ends with .lock
    /^-/, // starts with -
  ];

  if (!name || name.trim() === '') {
    return false;
  }

  return !invalidPatterns.some((pattern) => pattern.test(name));
}

/**
 * Sanitize a string to be used as a branch name
 */
export function sanitizeBranchName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_/]/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

/**
 * Get the current git branch name
 */
export async function getCurrentBranch(cwd?: string): Promise<string | undefined> {
  try {
    const result = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
  } catch {
    // Ignore errors
  }
  return undefined;
}

/**
 * Get the current HEAD commit hash
 */
export async function getHeadCommit(cwd?: string): Promise<string | undefined> {
  try {
    const result = await runCommand('git', ['rev-parse', 'HEAD'], { cwd });
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
  } catch {
    // Ignore errors
  }
  return undefined;
}

/**
 * Check if a directory is a git repository
 */
export async function isGitRepository(dirPath: string): Promise<boolean> {
  try {
    const result = await runCommand('git', ['rev-parse', '--git-dir'], { cwd: dirPath });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get the root directory of a git repository
 */
export async function getGitRoot(cwd?: string): Promise<string | undefined> {
  try {
    const result = await runCommand('git', ['rev-parse', '--show-toplevel'], { cwd });
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
  } catch {
    // Ignore errors
  }
  return undefined;
}

/**
 * Get the default branch name (main or master)
 */
export async function getDefaultBranch(cwd?: string): Promise<string> {
  try {
    // Try to get from remote origin
    const result = await runCommand(
      'git',
      ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
      { cwd }
    );
    if (result.exitCode === 0) {
      const branch = result.stdout.trim();
      return branch.replace('origin/', '');
    }
  } catch {
    // Ignore errors
  }

  // Fall back to checking if main or master exist
  try {
    const mainResult = await runCommand('git', ['rev-parse', '--verify', 'main'], { cwd });
    if (mainResult.exitCode === 0) {
      return 'main';
    }
  } catch {
    // Ignore
  }

  return 'master';
}

/**
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(cwd?: string): Promise<boolean> {
  try {
    const result = await runCommand('git', ['status', '--porcelain'], { cwd });
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Get list of changed files
 */
export async function getChangedFiles(cwd?: string): Promise<string[]> {
  try {
    const result = await runCommand('git', ['status', '--porcelain'], { cwd });
    if (result.exitCode === 0 && result.stdout.trim()) {
      return result.stdout
        .trim()
        .split('\n')
        .map(line => line.slice(3).trim())
        .filter(Boolean);
    }
  } catch {
    // Ignore errors
  }
  return [];
}

/**
 * Get diff between two commits or refs
 */
export async function getDiff(
  from: string,
  to: string = 'HEAD',
  cwd?: string
): Promise<string | undefined> {
  try {
    const result = await runCommand('git', ['diff', from, to], { cwd });
    if (result.exitCode === 0) {
      return result.stdout;
    }
  } catch {
    // Ignore errors
  }
  return undefined;
}

/**
 * Create a new branch
 */
export async function createBranch(name: string, cwd?: string): Promise<boolean> {
  try {
    const result = await runCommand('git', ['checkout', '-b', name], { cwd });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Checkout an existing branch
 */
export async function checkoutBranch(name: string, cwd?: string): Promise<boolean> {
  try {
    const result = await runCommand('git', ['checkout', name], { cwd });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Stage files for commit
 */
export async function stageFiles(files: string[], cwd?: string): Promise<boolean> {
  try {
    const result = await runCommand('git', ['add', ...files], { cwd });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Create a commit
 */
export async function commit(message: string, cwd?: string): Promise<boolean> {
  try {
    const result = await runCommand('git', ['commit', '-m', message], { cwd });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get the remote URL
 */
export async function getRemoteUrl(remote: string = 'origin', cwd?: string): Promise<string | undefined> {
  try {
    const result = await runCommand('git', ['remote', 'get-url', remote], { cwd });
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
  } catch {
    // Ignore errors
  }
  return undefined;
}
