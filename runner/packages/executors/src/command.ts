/**
 * Command execution utilities
 * Displaced from @runner/utils (not in Rust crate utils)
 *
 * These utilities were removed from utils to keep it a faithful translation
 * of crates/utils. They live here in executors as the primary consumer.
 */

import { spawn, type SpawnOptions } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { getShellCommand } from '@runner/utils';

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
 * Check if a command exists
 */
export function commandExists(command: string): boolean {
  return which(command) !== undefined;
}
