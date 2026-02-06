/**
 * Asset management utilities
 * Translates: crates/utils/src/assets.rs
 *
 * Manages application assets and asset directories.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

export function getAssetDir(): string {
  // TODO: Implement asset directory resolution
  // In Rust, this uses platform-specific paths
  const homeDir = os.homedir();
  return path.join(homeDir, '.vibe-kanban', 'assets');
}

export async function ensureAssetDir(): Promise<string> {
  const assetDir = getAssetDir();
  await fs.mkdir(assetDir, { recursive: true });
  return assetDir;
}

export function getDbPath(): string {
  return path.join(getAssetDir(), 'db.sqlite');
}

export function getConfigPath(): string {
  return path.join(getAssetDir(), 'config.json');
}

export function getPortFilePath(): string {
  return path.join(getAssetDir(), 'port');
}
