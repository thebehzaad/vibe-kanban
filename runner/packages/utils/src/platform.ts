/**
 * Platform detection utilities
 * Translates: crates/utils/src/lib.rs (platform detection parts)
 */

import * as fs from 'node:fs';

/** Cached WSL2 detection result */
let wsl2Cache: boolean | undefined;

/**
 * Check if running in WSL2 (cached)
 */
export function isWsl2(): boolean {
  if (wsl2Cache !== undefined) {
    return wsl2Cache;
  }

  wsl2Cache = detectWsl2();
  return wsl2Cache;
}

/**
 * Detect if running in WSL2
 */
function detectWsl2(): boolean {
  // Check for WSL environment variables
  if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) {
    return true;
  }

  // Check /proc/version for WSL2 signature
  try {
    const version = fs.readFileSync('/proc/version', 'utf-8');
    if (version.includes('WSL2') || version.includes('microsoft')) {
      return true;
    }
  } catch {
    // Not on Linux or can't read /proc/version
  }

  return false;
}

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return process.platform === 'linux';
}

/**
 * Get the current platform name
 */
export function getPlatformName(): string {
  if (isWsl2()) {
    return 'wsl2';
  }
  return process.platform;
}

/**
 * Check if running in a CI environment
 */
export function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.CONTINUOUS_INTEGRATION ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.TRAVIS
  );
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
