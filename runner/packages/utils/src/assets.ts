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

export async function ensureCacheDir(): Promise<string> {
  // Import getCacheDir from path to avoid duplicate export
  const { getCacheDir } = await import('./path.js');
  const cacheDir = getCacheDir();
  await fs.mkdir(cacheDir, { recursive: true });
  return cacheDir;
}

/**
 * Get or create cached PowerShell script file
 * Translates: crates/utils/src/lib.rs::get_powershell_script()
 */
export async function getPowerShellScript(): Promise<string> {
  const cacheDir = await ensureCacheDir();
  const scriptPath = path.join(cacheDir, 'toast-notification.ps1');

  // Check if cached file already exists and is valid
  try {
    const stat = await fs.stat(scriptPath);
    if (stat.size > 0) {
      return scriptPath;
    }
  } catch {
    // File doesn't exist, will create it
  }

  // TODO: Copy embedded PowerShell script from assets
  // For now, create a placeholder
  const scriptContent = `
# Toast notification script
# TODO: Implement actual notification script
Write-Host "Notification placeholder"
  `.trim();

  await fs.writeFile(scriptPath, scriptContent, 'utf-8');
  return scriptPath;
}
