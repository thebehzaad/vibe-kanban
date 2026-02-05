/**
 * Path utilities
 * Translates: crates/utils/src/path.rs
 */

import * as path from 'node:path';
import * as os from 'node:os';

export function expandHome(filepath: string): string {
  if (filepath.startsWith('~')) {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

export function normalizePath(filepath: string): string {
  return path.normalize(filepath).replace(/\\/g, '/');
}

// TODO: Implement additional path utilities from crates/utils/src/path.rs
