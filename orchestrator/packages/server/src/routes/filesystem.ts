/**
 * Filesystem routes
 * Translates: crates/server/src/routes/filesystem.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

// Types
export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size?: number;
  modifiedAt?: string;
  isHidden: boolean;
}

export interface DirectoryListing {
  path: string;
  entries: DirectoryEntry[];
  parentPath?: string;
}

export interface GitRepo {
  path: string;
  name: string;
  branch?: string;
  remote?: string;
  isDirty: boolean;
}

export const filesystemRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/filesystem/directory - List directory contents
  fastify.get<{ Querystring: { path: string; show_hidden?: boolean } }>(
    '/filesystem/directory',
    async (request, reply) => {
      const { path: dirPath, show_hidden = false } = request.query;

      if (!dirPath) {
        return reply.status(400).send({ error: 'Path is required' });
      }

      // Resolve and validate path
      const resolvedPath = path.resolve(dirPath);

      try {
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) {
          return reply.status(400).send({ error: 'Path is not a directory' });
        }
      } catch (err) {
        return reply.status(404).send({ error: 'Directory not found' });
      }

      try {
        const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
        const directoryEntries: DirectoryEntry[] = [];

        for (const entry of entries) {
          // Skip hidden files unless requested
          const isHidden = entry.name.startsWith('.');
          if (isHidden && !show_hidden) continue;

          const entryPath = path.join(resolvedPath, entry.name);
          let size: number | undefined;
          let modifiedAt: string | undefined;

          try {
            const stats = await fs.stat(entryPath);
            size = stats.size;
            modifiedAt = stats.mtime.toISOString();
          } catch {
            // Ignore stat errors (broken symlinks, etc.)
          }

          let type: DirectoryEntry['type'] = 'file';
          if (entry.isDirectory()) type = 'directory';
          else if (entry.isSymbolicLink()) type = 'symlink';

          directoryEntries.push({
            name: entry.name,
            path: entryPath,
            type,
            size,
            modifiedAt,
            isHidden
          });
        }

        // Sort: directories first, then alphabetically
        directoryEntries.sort((a, b) => {
          if (a.type === 'directory' && b.type !== 'directory') return -1;
          if (a.type !== 'directory' && b.type === 'directory') return 1;
          return a.name.localeCompare(b.name);
        });

        const parentPath = path.dirname(resolvedPath);
        const result: DirectoryListing = {
          path: resolvedPath,
          entries: directoryEntries,
          parentPath: parentPath !== resolvedPath ? parentPath : undefined
        };

        return result;
      } catch (err) {
        fastify.log.error(`Error reading directory ${resolvedPath}:`, err);
        return reply.status(500).send({ error: 'Failed to read directory' });
      }
    }
  );

  // GET /api/filesystem/git-repos - List git repositories in path
  fastify.get<{ Querystring: { path: string; depth?: number } }>(
    '/filesystem/git-repos',
    async (request, reply) => {
      const { path: searchPath, depth = 3 } = request.query;

      if (!searchPath) {
        return reply.status(400).send({ error: 'Path is required' });
      }

      const resolvedPath = path.resolve(searchPath);

      try {
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) {
          return reply.status(400).send({ error: 'Path is not a directory' });
        }
      } catch {
        return reply.status(404).send({ error: 'Directory not found' });
      }

      const repos: GitRepo[] = [];

      async function findGitRepos(dir: string, currentDepth: number): Promise<void> {
        if (currentDepth > depth) return;

        try {
          const gitPath = path.join(dir, '.git');
          const hasGit = await fs.access(gitPath).then(() => true).catch(() => false);

          if (hasGit) {
            const repo = await getGitRepoInfo(dir);
            if (repo) repos.push(repo);
            return; // Don't recurse into git repos
          }

          // Recurse into subdirectories
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
              await findGitRepos(path.join(dir, entry.name), currentDepth + 1);
            }
          }
        } catch {
          // Ignore permission errors, etc.
        }
      }

      await findGitRepos(resolvedPath, 0);

      return {
        searchPath: resolvedPath,
        repos,
        total: repos.length
      };
    }
  );

  // GET /api/filesystem/file - Read file contents (with size limit)
  fastify.get<{ Querystring: { path: string; max_size?: number } }>(
    '/filesystem/file',
    async (request, reply) => {
      const { path: filePath, max_size = 1024 * 1024 } = request.query; // 1MB default

      if (!filePath) {
        return reply.status(400).send({ error: 'Path is required' });
      }

      const resolvedPath = path.resolve(filePath);

      try {
        const stats = await fs.stat(resolvedPath);

        if (!stats.isFile()) {
          return reply.status(400).send({ error: 'Path is not a file' });
        }

        if (stats.size > max_size) {
          return reply.status(400).send({
            error: 'File too large',
            size: stats.size,
            maxSize: max_size
          });
        }

        const content = await fs.readFile(resolvedPath, 'utf-8');

        return {
          path: resolvedPath,
          content,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString()
        };
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          return reply.status(404).send({ error: 'File not found' });
        }
        throw err;
      }
    }
  );

  // POST /api/filesystem/file - Write file contents
  fastify.post<{ Body: { path: string; content: string; create_dirs?: boolean } }>(
    '/filesystem/file',
    async (request, reply) => {
      const { path: filePath, content, create_dirs = true } = request.body;

      if (!filePath) {
        return reply.status(400).send({ error: 'Path is required' });
      }

      const resolvedPath = path.resolve(filePath);

      try {
        if (create_dirs) {
          await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        }

        await fs.writeFile(resolvedPath, content, 'utf-8');
        const stats = await fs.stat(resolvedPath);

        return {
          success: true,
          path: resolvedPath,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString()
        };
      } catch (err: any) {
        fastify.log.error(`Error writing file ${resolvedPath}:`, err);
        return reply.status(500).send({ error: 'Failed to write file', details: err.message });
      }
    }
  );
};

// Helper function to get git repo info
async function getGitRepoInfo(repoPath: string): Promise<GitRepo | null> {
  try {
    const name = path.basename(repoPath);
    let branch: string | undefined;
    let remote: string | undefined;
    let isDirty = false;

    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
    } catch {
      // Ignore
    }

    try {
      remote = execSync('git remote get-url origin', {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
    } catch {
      // Ignore
    }

    try {
      const status = execSync('git status --porcelain', {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      isDirty = status.trim().length > 0;
    } catch {
      // Ignore
    }

    return { path: repoPath, name, branch, remote, isDirty };
  } catch {
    return null;
  }
}
