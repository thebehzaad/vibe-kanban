/**
 * Process management utilities
 * Displaced from @runner/utils (not in Rust crate utils)
 *
 * These utilities were removed from utils to keep it a faithful translation
 * of crates/utils. They live here in local-deployment as the primary consumer.
 */

import { type ChildProcess } from 'node:child_process';
import { killProcessGroup } from '@runner/utils';

/**
 * Check if a process is alive
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a child process and wait for it to exit
 */
export async function killChildProcess(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) {
    return;
  }

  await killProcessGroup(child.pid);
}

/**
 * Gracefully terminate a process with a timeout
 */
export async function terminateProcess(
  pid: number,
  timeoutMs: number = 5000
): Promise<boolean> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return true;
  }

  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await sleep(100);
  }

  try {
    process.kill(pid, 'SIGKILL');
    await sleep(100);
    return !isProcessAlive(pid);
  } catch {
    return true;
  }
}

/**
 * Wait for a process to exit
 */
export function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }

    child.on('exit', (code) => {
      resolve(code);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
