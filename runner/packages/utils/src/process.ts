/**
 * Process management utilities
 * Translates: crates/utils/src/process.rs
 */

import { ChildProcess, spawn } from 'node:child_process';

/**
 * Kill a process and all its children
 * On Unix, this sends signals to the process group
 * On Windows, this uses taskkill
 */
export async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    return killProcessTreeWindows(pid);
  } else {
    return killProcessTreeUnix(pid);
  }
}

/**
 * Kill a process tree on Windows using taskkill
 */
async function killProcessTreeWindows(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('taskkill', ['/pid', pid.toString(), '/f', '/t'], {
      stdio: 'ignore',
    });

    proc.on('close', () => {
      resolve();
    });

    proc.on('error', (err) => {
      // Process may already be dead
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
        resolve();
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Kill a process tree on Unix using signals
 */
async function killProcessTreeUnix(pid: number): Promise<void> {
  const signals = ['SIGINT', 'SIGTERM', 'SIGKILL'] as const;

  for (const signal of signals) {
    try {
      // Try to kill the process group (negative PID)
      process.kill(-pid, signal);
    } catch (err) {
      // Process may already be dead or not a process group leader
      try {
        process.kill(pid, signal);
      } catch {
        // Process is definitely dead
        return;
      }
    }

    // Wait a bit for the process to exit
    await sleep(500);

    // Check if process is still alive
    if (!isProcessAlive(pid)) {
      return;
    }
  }
}

/**
 * Check if a process is alive
 */
export function isProcessAlive(pid: number): boolean {
  try {
    // Sending signal 0 doesn't kill the process but checks if it exists
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

  await killProcessTree(child.pid);
}

/**
 * Gracefully terminate a process with a timeout
 */
export async function terminateProcess(
  pid: number,
  timeoutMs: number = 5000
): Promise<boolean> {
  // First, try SIGTERM
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Process may already be dead
    return true;
  }

  // Wait for the process to exit
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await sleep(100);
  }

  // If still alive, force kill
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

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
