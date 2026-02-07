/**
 * Browser utilities
 * Translates: crates/utils/src/browser.rs
 */

import { spawn } from 'node:child_process';
import { isWsl2 } from './wsl.js';

/**
 * Open URL in the default browser
 * Handles WSL2 by using PowerShell to open the browser
 */
export async function openBrowser(url: string): Promise<void> {
  if (isWsl2()) {
    // In WSL2, use PowerShell to open the browser
    return new Promise((resolve, reject) => {
      const proc = spawn('powershell.exe', ['-Command', `Start-Process '${url}'`], {
        stdio: 'ignore',
        detached: true,
      });

      proc.on('error', reject);
      proc.on('spawn', () => {
        proc.unref();
        resolve();
      });
    });
  }

  // Use platform-specific commands for other systems
  const { command, args } = getOpenCommand(url);

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
    });

    proc.on('error', reject);
    proc.on('spawn', () => {
      proc.unref();
      resolve();
    });
  });
}

/**
 * Get the platform-specific command to open a URL
 */
function getOpenCommand(url: string): { command: string; args: string[] } {
  switch (process.platform) {
    case 'darwin':
      return { command: 'open', args: [url] };
    case 'win32':
      return { command: 'cmd', args: ['/c', 'start', '', url] };
    default:
      // Linux and others
      return { command: 'xdg-open', args: [url] };
  }
}
