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
