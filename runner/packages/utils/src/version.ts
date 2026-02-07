/**
 * Version utilities
 * Translates: crates/utils/src/version.rs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

let cachedVersion: string | undefined;

/**
 * The current application version.
 * Matches Rust: pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION")
 *
 * In Node.js we read from package.json instead of a compile-time constant.
 */
export function getAppVersion(): string {
  if (cachedVersion !== undefined) {
    return cachedVersion;
  }

  try {
    let currentDir = process.cwd();

    for (let i = 0; i < 10; i++) {
      const packagePath = path.join(currentDir, 'package.json');
      if (fs.existsSync(packagePath)) {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
        if (packageJson.version) {
          cachedVersion = packageJson.version as string;
          return cachedVersion;
        }
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }

    cachedVersion = '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }

  return cachedVersion!;
}
