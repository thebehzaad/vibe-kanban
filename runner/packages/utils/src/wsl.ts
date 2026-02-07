/**
 * WSL2 detection
 * Translates: crates/utils/src/lib.rs (is_wsl2)
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
