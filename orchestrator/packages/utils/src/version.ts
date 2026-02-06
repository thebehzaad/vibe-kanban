/**
 * Version utilities
 * Translates: crates/utils/src/version.rs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Cached application version */
let cachedVersion: string | undefined;

/**
 * Get the application version from package.json
 */
export function getAppVersion(): string {
  if (cachedVersion !== undefined) {
    return cachedVersion;
  }

  // Try to find and read the root package.json
  try {
    // Walk up from current directory to find package.json
    let currentDir = process.cwd();
    let found = false;

    for (let i = 0; i < 10; i++) {
      const packagePath = path.join(currentDir, 'package.json');
      if (fs.existsSync(packagePath)) {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
        if (packageJson.version) {
          cachedVersion = packageJson.version;
          found = true;
          break;
        }
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }

    if (!found) {
      cachedVersion = '0.0.0';
    }
  } catch {
    cachedVersion = '0.0.0';
  }

  return cachedVersion!;
}

/**
 * Compare two semver version strings
 * Returns:
 *  - negative if a < b
 *  - 0 if a == b
 *  - positive if a > b
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(p => parseInt(p, 10) || 0);
  const partsB = b.split('.').map(p => parseInt(p, 10) || 0);

  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const partA = partsA[i] || 0;
    const partB = partsB[i] || 0;

    if (partA !== partB) {
      return partA - partB;
    }
  }

  return 0;
}

/**
 * Check if version a is greater than version b
 */
export function isVersionGreater(a: string, b: string): boolean {
  return compareVersions(a, b) > 0;
}

/**
 * Check if version a is less than version b
 */
export function isVersionLess(a: string, b: string): boolean {
  return compareVersions(a, b) < 0;
}

/**
 * Parse a version string into its components
 */
export function parseVersion(version: string): { major: number; minor: number; patch: number; prerelease?: string } {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);

  if (!match) {
    return { major: 0, minor: 0, patch: 0 };
  }

  return {
    major: parseInt(match[1] || '0', 10),
    minor: parseInt(match[2] || '0', 10),
    patch: parseInt(match[3] || '0', 10),
    prerelease: match[4],
  };
}
