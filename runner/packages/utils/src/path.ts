/**
 * Path utilities
 * Translates: crates/utils/src/path.rs
 */

import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

/** Directory name for storing images in worktrees */
export const VIBE_IMAGES_DIR = '.vibe-images';

/** Directories that should always be skipped regardless of gitignore */
export const ALWAYS_SKIP_DIRS = ['.git', 'node_modules'];

/**
 * Expand leading ~ to user's home directory
 */
export function expandHome(filepath: string): string {
  if (filepath.startsWith('~')) {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

/**
 * Alias for expandHome (matches Rust name)
 */
export function expandTilde(filepath: string): string {
  return expandHome(filepath);
}

/**
 * Normalize path to use forward slashes
 */
export function normalizePath(filepath: string): string {
  return path.normalize(filepath).replace(/\\/g, '/');
}

/**
 * Normalize macOS prefix /private/var/ and /private/tmp/ to their public aliases
 */
export function normalizeMacosPrivateAlias(p: string): string {
  if (process.platform !== 'darwin') {
    return p;
  }

  if (p === '/private/var') {
    return '/var';
  }
  if (p.startsWith('/private/var/')) {
    return '/var/' + p.slice('/private/var/'.length);
  }
  if (p === '/private/tmp') {
    return '/tmp';
  }
  if (p.startsWith('/private/tmp/')) {
    return '/tmp/' + p.slice('/private/tmp/'.length);
  }

  return p;
}

/**
 * Convert absolute paths to relative paths based on worktree path
 */
export function makePathRelative(absolutePath: string, worktreePath: string): string {
  const normalizedPath = normalizeMacosPrivateAlias(absolutePath);
  const normalizedWorktree = normalizeMacosPrivateAlias(worktreePath);

  // If path is already relative, return as is
  if (!path.isAbsolute(normalizedPath)) {
    return absolutePath;
  }

  // Try direct prefix stripping
  if (normalizedPath.startsWith(normalizedWorktree)) {
    const relative = normalizedPath.slice(normalizedWorktree.length);
    const trimmed = relative.startsWith('/') || relative.startsWith('\\')
      ? relative.slice(1)
      : relative;
    return trimmed || '.';
  }

  // Try with canonical paths if both exist
  try {
    if (fs.existsSync(absolutePath) && fs.existsSync(worktreePath)) {
      const canonPath = fs.realpathSync(absolutePath);
      const canonWorktree = fs.realpathSync(worktreePath);

      if (canonPath.startsWith(canonWorktree)) {
        const relative = canonPath.slice(canonWorktree.length);
        const trimmed = relative.startsWith('/') || relative.startsWith('\\')
          ? relative.slice(1)
          : relative;
        return trimmed || '.';
      }
    }
  } catch {
    // Fall through to return original
  }

  return absolutePath;
}

/**
 * Get the vibe-kanban temporary directory
 */
export function getVibeKanbanTempDir(): string {
  const dirName = process.env.NODE_ENV === 'development' ? 'vibe-kanban-dev' : 'vibe-kanban';

  if (process.platform === 'darwin') {
    // macOS already uses /var/folders/... which is persistent storage
    return path.join(os.tmpdir(), dirName);
  } else if (process.platform === 'linux') {
    // Linux: use /var/tmp instead of /tmp to avoid RAM usage
    return path.join('/var/tmp', dirName);
  } else {
    // Windows and other platforms: use temp dir with vibe-kanban subdirectory
    return path.join(os.tmpdir(), dirName);
  }
}

/**
 * Get the cache directory for the application
 */
export function getCacheDir(): string {
  const appName = process.env.NODE_ENV === 'development' ? 'vibe-kanban-dev' : 'vibe-kanban';

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', appName);
  } else if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), appName);
  } else {
    // Linux: respect XDG_CACHE_HOME
    const xdgCache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
    return path.join(xdgCache, appName);
  }
}

/**
 * Get the data directory for the application
 */
export function getDataDir(): string {
  const appName = process.env.NODE_ENV === 'development' ? 'vibe-kanban-dev' : 'vibe-kanban';

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName);
  } else if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), appName);
  } else {
    // Linux: respect XDG_DATA_HOME
    const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    return path.join(xdgData, appName);
  }
}

/**
 * Ensure a directory exists
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Check if a path is within another path
 */
export function isPathWithin(childPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
