/**
 * Shell command utilities
 * Translates: crates/utils/src/shell.rs
 */

import { spawn, SpawnOptions, execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface StreamingCommandOptions extends SpawnOptions {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  timeout?: number;
}

/**
 * Run a command and return the result
 */
export async function runCommand(
  command: string,
  args: string[],
  options?: SpawnOptions
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1
      });
    });

    proc.on('error', reject);
  });
}

/**
 * Run a command with streaming output
 */
export async function runCommandStreaming(
  command: string,
  args: string[],
  options?: StreamingCommandOptions
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout | undefined;

    if (options?.timeout) {
      timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Command timed out after ${options.timeout}ms`));
      }, options.timeout);
    }

    proc.stdout?.on('data', (data) => {
      const str = data.toString();
      stdout += str;
      options?.onStdout?.(str);
    });

    proc.stderr?.on('data', (data) => {
      const str = data.toString();
      stderr += str;
      options?.onStderr?.(str);
    });

    proc.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1
      });
    });

    proc.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * Run a shell command (through the default shell)
 */
export async function runShellCommand(
  command: string,
  options?: SpawnOptions
): Promise<CommandResult> {
  const { shell, shellArg } = getShellCommand();
  return runCommand(shell, [shellArg, command], options);
}

/**
 * Get the appropriate shell command for the current platform
 */
export function getShellCommand(): { shell: string; shellArg: string } {
  if (process.platform === 'win32') {
    return { shell: 'cmd', shellArg: '/C' };
  }

  // Check for user's shell from environment
  const userShell = process.env.SHELL;
  if (userShell && fs.existsSync(userShell)) {
    return { shell: userShell, shellArg: '-c' };
  }

  // Fallback to common shells
  const shells = ['/bin/zsh', '/bin/bash', '/bin/sh'];
  for (const shell of shells) {
    if (fs.existsSync(shell)) {
      return { shell, shellArg: '-c' };
    }
  }

  return { shell: '/bin/sh', shellArg: '-c' };
}

/**
 * Get the interactive shell path (for PTY sessions)
 */
export async function getInteractiveShell(): Promise<string> {
  if (process.platform === 'win32') {
    // Try PowerShell first
    const powershell = await resolveExecutablePath('powershell.exe');
    if (powershell) return powershell;
    return 'cmd.exe';
  }

  // Use user's shell
  const userShell = process.env.SHELL;
  if (userShell && fs.existsSync(userShell)) {
    return userShell;
  }

  return '/bin/sh';
}

/**
 * Resolve an executable path, checking PATH and common locations
 */
export async function resolveExecutablePath(executable: string): Promise<string | undefined> {
  if (!executable || !executable.trim()) {
    return undefined;
  }

  // Check if it's already an absolute path
  if (path.isAbsolute(executable) && fs.existsSync(executable)) {
    return executable;
  }

  // Try to find in PATH
  const found = which(executable);
  if (found) return found;

  // On Windows, try common locations
  if (process.platform === 'win32') {
    const commonPaths = [
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)')
    ];

    for (const basePath of commonPaths) {
      const fullPath = path.join(basePath, executable);
      if (fs.existsSync(fullPath)) return fullPath;
    }
  }

  return undefined;
}

/**
 * Find executable in PATH (synchronous)
 */
export function which(executable: string): string | undefined {
  const pathEnv = process.env.PATH || '';
  const pathSeparator = process.platform === 'win32' ? ';' : ':';
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];

  for (const dir of pathEnv.split(pathSeparator)) {
    if (!dir) continue;

    for (const ext of extensions) {
      const fullPath = path.join(dir, executable + ext);
      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          // On Unix, check if executable
          if (process.platform !== 'win32') {
            try {
              fs.accessSync(fullPath, fs.constants.X_OK);
              return fullPath;
            } catch {
              continue;
            }
          }
          return fullPath;
        }
      } catch {
        continue;
      }
    }
  }

  return undefined;
}

/**
 * Merge two PATH-like strings, deduplicating entries
 */
export function mergePaths(primary: string, secondary: string): string {
  const separator = process.platform === 'win32' ? ';' : ':';
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const pathStr of [primary, secondary]) {
    for (const p of pathStr.split(separator)) {
      const normalized = p.trim();
      if (normalized && !seen.has(normalized.toLowerCase())) {
        seen.add(normalized.toLowerCase());
        merged.push(normalized);
      }
    }
  }

  return merged.join(separator);
}

/**
 * Check if a command exists
 */
export function commandExists(command: string): boolean {
  return which(command) !== undefined;
}

/**
 * Get the current working shell type
 */
export type ShellType = 'zsh' | 'bash' | 'sh' | 'cmd' | 'powershell' | 'other';

export function getCurrentShellType(): ShellType {
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || '';
    if (comspec.toLowerCase().includes('powershell')) return 'powershell';
    return 'cmd';
  }

  const shell = process.env.SHELL || '';
  if (shell.endsWith('/zsh')) return 'zsh';
  if (shell.endsWith('/bash')) return 'bash';
  if (shell.endsWith('/sh')) return 'sh';

  return 'other';
}

/**
 * Get shell config file path
 */
export function getShellConfigFile(): string | undefined {
  const home = os.homedir();
  const shellType = getCurrentShellType();

  switch (shellType) {
    case 'zsh':
      return path.join(home, '.zshrc');
    case 'bash':
      return path.join(home, '.bashrc');
    default:
      return undefined;
  }
}
