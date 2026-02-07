/**
 * Port file utilities
 * Translates: crates/utils/src/port_file.rs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Write the port number to a file for discovery by other processes
 */
export async function writePortFile(port: number, appName: string = 'vibe-kanban'): Promise<string> {
  const dir = path.join(os.tmpdir(), appName);
  const portFilePath = path.join(dir, `${appName}.port`);

  // Ensure directory exists
  await fs.promises.mkdir(dir, { recursive: true });

  // Write port to file
  await fs.promises.writeFile(portFilePath, port.toString(), 'utf-8');

  return portFilePath;
}

/**
 * Write the port number to a file synchronously
 */
export function writePortFileSync(port: number, appName: string = 'vibe-kanban'): string {
  const dir = path.join(os.tmpdir(), appName);
  const portFilePath = path.join(dir, `${appName}.port`);

  // Ensure directory exists
  fs.mkdirSync(dir, { recursive: true });

  // Write port to file
  fs.writeFileSync(portFilePath, port.toString(), 'utf-8');

  return portFilePath;
}

/**
 * Read the port number from a file
 */
export async function readPortFile(appName: string = 'vibe-kanban'): Promise<number> {
  const dir = path.join(os.tmpdir(), appName);
  const portFilePath = path.join(dir, `${appName}.port`);

  const content = await fs.promises.readFile(portFilePath, 'utf-8');
  const port = parseInt(content.trim(), 10);

  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port number in file: ${content}`);
  }

  return port;
}

/**
 * Read the port number from a file synchronously
 */
export function readPortFileSync(appName: string = 'vibe-kanban'): number {
  const dir = path.join(os.tmpdir(), appName);
  const portFilePath = path.join(dir, `${appName}.port`);

  const content = fs.readFileSync(portFilePath, 'utf-8');
  const port = parseInt(content.trim(), 10);

  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port number in file: ${content}`);
  }

  return port;
}

/**
 * Delete the port file
 */
export async function deletePortFile(appName: string = 'vibe-kanban'): Promise<void> {
  const dir = path.join(os.tmpdir(), appName);
  const portFilePath = path.join(dir, `${appName}.port`);

  try {
    await fs.promises.unlink(portFilePath);
  } catch (err) {
    // Ignore errors if file doesn't exist
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Delete the port file synchronously
 */
export function deletePortFileSync(appName: string = 'vibe-kanban'): void {
  const dir = path.join(os.tmpdir(), appName);
  const portFilePath = path.join(dir, `${appName}.port`);

  try {
    fs.unlinkSync(portFilePath);
  } catch (err) {
    // Ignore errors if file doesn't exist
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Check if a port file exists
 */
export function portFileExists(appName: string = 'vibe-kanban'): boolean {
  const dir = path.join(os.tmpdir(), appName);
  const portFilePath = path.join(dir, `${appName}.port`);

  return fs.existsSync(portFilePath);
}
