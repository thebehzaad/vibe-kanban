/**
 * Filesystem service - Full implementation
 * Translates: crates/services/src/filesystem.rs
 */

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';

export interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: Date;
  createdAt: Date;
  permissions?: string;
}

export interface FileWatchEvent {
  type: 'change' | 'rename';
  filename: string;
}

export type FileWatchHandler = (event: FileWatchEvent) => void;

export class FilesystemService {
  private watchers: Map<string, FSWatcher> = new Map();

  constructor(private basePath: string) {}

  private resolve(filePath: string): string {
    return path.resolve(this.basePath, filePath);
  }

  // ─── Read Operations ──────────────────────────────────────────────

  async readFile(filePath: string): Promise<string> {
    return fs.readFile(this.resolve(filePath), 'utf-8');
  }

  async readBinaryFile(filePath: string): Promise<Buffer> {
    return fs.readFile(this.resolve(filePath));
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(filePath));
      return true;
    } catch {
      return false;
    }
  }

  async getFileMetadata(filePath: string): Promise<FileInfo> {
    const fullPath = this.resolve(filePath);
    const stats = await fs.stat(fullPath);
    return {
      path: filePath,
      name: path.basename(filePath),
      isDirectory: stats.isDirectory(),
      size: stats.size,
      modifiedAt: stats.mtime,
      createdAt: stats.birthtime,
    };
  }

  // ─── Write Operations ─────────────────────────────────────────────

  async writeFile(filePath: string, content: string): Promise<void> {
    const fullPath = this.resolve(filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async writeBinaryFile(filePath: string, content: Buffer): Promise<void> {
    const fullPath = this.resolve(filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }

  // ─── Directory Operations ─────────────────────────────────────────

  async listDirectory(dirPath: string): Promise<FileInfo[]> {
    const fullPath = this.resolve(dirPath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    return Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(fullPath, entry.name);
        const stats = await fs.stat(entryPath);
        return {
          path: path.join(dirPath, entry.name),
          name: entry.name,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          modifiedAt: stats.mtime,
          createdAt: stats.birthtime,
        };
      })
    );
  }

  async createDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(this.resolve(dirPath), { recursive: true });
  }

  // ─── Delete Operations ────────────────────────────────────────────

  async deleteFile(filePath: string): Promise<void> {
    await fs.unlink(this.resolve(filePath));
  }

  async deleteDirectory(dirPath: string): Promise<void> {
    await fs.rm(this.resolve(dirPath), { recursive: true, force: true });
  }

  // ─── Move/Copy Operations ────────────────────────────────────────

  async moveFile(srcPath: string, destPath: string): Promise<void> {
    const src = this.resolve(srcPath);
    const dest = this.resolve(destPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(src, dest);
  }

  async copyFile(srcPath: string, destPath: string): Promise<void> {
    const src = this.resolve(srcPath);
    const dest = this.resolve(destPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }

  // ─── Search ───────────────────────────────────────────────────────

  async searchFiles(pattern: string, dirPath: string = '.'): Promise<string[]> {
    const results: string[] = [];
    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i');

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(this.resolve(dir), { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        if (entry.isDirectory()) {
          await walk(entryPath);
        } else if (regex.test(entry.name)) {
          results.push(entryPath);
        }
      }
    };

    await walk(dirPath);
    return results;
  }

  // ─── Watch Operations ─────────────────────────────────────────────

  watchFile(filePath: string, handler: FileWatchHandler): () => void {
    const fullPath = this.resolve(filePath);
    const watcher = watch(fullPath, (eventType, filename) => {
      handler({
        type: eventType as 'change' | 'rename',
        filename: filename ?? filePath,
      });
    });
    const key = `file:${filePath}`;
    this.watchers.set(key, watcher);
    return () => {
      watcher.close();
      this.watchers.delete(key);
    };
  }

  watchDirectory(dirPath: string, handler: FileWatchHandler): () => void {
    const fullPath = this.resolve(dirPath);
    const watcher = watch(fullPath, { recursive: true }, (eventType, filename) => {
      handler({
        type: eventType as 'change' | 'rename',
        filename: filename ?? dirPath,
      });
    });
    const key = `dir:${dirPath}`;
    this.watchers.set(key, watcher);
    return () => {
      watcher.close();
      this.watchers.delete(key);
    };
  }

  /** Close all watchers */
  closeAllWatchers(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}
