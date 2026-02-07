/**
 * Shell command utilities
 * Translates: crates/utils/src/shell.rs
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * Get the appropriate shell command for the current platform.
 * Matches Rust: get_shell_command()
 */
export function getShellCommand(): { shell: string; shellArg: string } {
  if (process.platform === 'win32') {
    return { shell: 'powershell.exe', shellArg: '/c' };
  }

  const userShell = process.env.SHELL;
  if (userShell && fs.existsSync(userShell)) {
    return { shell: userShell, shellArg: '-c' };
  }

  const shells = ['/bin/zsh', '/bin/bash', '/bin/sh'];
  for (const shell of shells) {
    if (fs.existsSync(shell)) {
      return { shell, shellArg: '-c' };
    }
  }

  return { shell: '/bin/sh', shellArg: '-c' };
}

/**
 * Get the interactive shell path (for PTY sessions).
 * Matches Rust: get_interactive_shell()
 */
export async function getInteractiveShell(): Promise<string> {
  if (process.platform === 'win32') {
    const powershell = await resolveExecutablePath('powershell.exe');
    if (powershell) return powershell;
    return 'cmd.exe';
  }

  const userShell = process.env.SHELL;
  if (userShell && fs.existsSync(userShell)) {
    return userShell;
  }

  return '/bin/sh';
}

/**
 * Resolve an executable path, checking PATH and common locations.
 * Matches Rust: resolve_executable_path()
 */
export async function resolveExecutablePath(executable: string): Promise<string | undefined> {
  if (!executable || !executable.trim()) {
    return undefined;
  }

  if (path.isAbsolute(executable) && fs.existsSync(executable)) {
    return executable;
  }

  const found = whichSync(executable);
  if (found) return found;

  if (process.platform === 'win32') {
    const commonPaths = [
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'),
    ];

    for (const basePath of commonPaths) {
      const fullPath = path.join(basePath, executable);
      if (fs.existsSync(fullPath)) return fullPath;
    }
  }

  return undefined;
}

/**
 * Resolve executable path synchronously.
 * Matches Rust: resolve_executable_path_blocking()
 */
export function resolveExecutablePathBlocking(executable: string): string | undefined {
  if (!executable || !executable.trim()) {
    return undefined;
  }

  if (path.isAbsolute(executable) && fs.existsSync(executable)) {
    return executable;
  }

  return whichSync(executable);
}

/**
 * Merge two PATH-like strings, deduplicating entries.
 * Matches Rust: merge_paths()
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

/** Internal: find executable in PATH (not exported, matches Rust's private which()) */
function whichSync(executable: string): string | undefined {
  const pathEnv = process.env.PATH || '';
  const pathSeparator = process.platform === 'win32' ? ';' : ':';
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
      : [''];

  for (const dir of pathEnv.split(pathSeparator)) {
    if (!dir) continue;

    for (const ext of extensions) {
      const fullPath = path.join(dir, executable + ext);
      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
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
