/**
 * Filesystem service
 * Translates: crates/services/src/filesystem.rs
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: Date;
}

export class FilesystemService {
  constructor(private basePath: string) {}

  async readFile(filePath: string): Promise<string> {
    const fullPath = path.join(this.basePath, filePath);
    return fs.readFile(fullPath, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.basePath, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async listDirectory(dirPath: string): Promise<FileInfo[]> {
    const fullPath = path.join(this.basePath, dirPath);
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
          modifiedAt: stats.mtime
        };
      })
    );
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.basePath, filePath));
      return true;
    } catch {
      return false;
    }
  }

  // TODO: Implement additional filesystem operations
}
