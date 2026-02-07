/**
 * Repository routes
 * Translates: crates/server/src/routes/repo.rs
 *
 * Rust pattern: State(deployment) → deployment.db().pool / deployment.repo()
 * TS pattern:   fastify.deployment → deployment.db() → new RepoRepository(db)
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { RepoRepository, type UpdateRepo } from '@runner/db';

// Re-export DB types for consumers (Repo aliased as Repository for route-level API)
export type { Repo as Repository } from '@runner/db';

// Types
export interface Branch {
  name: string;
  commit: string;
  isHead: boolean;
  isRemote: boolean;
  upstream?: string;
  aheadBehind?: { ahead: number; behind: number };
}

export interface Remote {
  name: string;
  url: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface PullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  headBranch: string;
  baseBranch: string;
  url: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRepoBody {
  path: string;
  name?: string;
  defaultTargetBranch?: string;
  defaultWorkingDir?: string;
}

export interface UpdateRepoBody {
  name?: string;
  defaultTargetBranch?: string;
  defaultWorkingDir?: string;
}

export interface InitRepoBody {
  path: string;
  name?: string;
  remote?: string;
}

export const repoRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const db = () => fastify.deployment.db();
  const getRepo = () => new RepoRepository(db());

  // GET /api/repos - List all repositories
  fastify.get('/repos', async () => {
    const repo = getRepo();
    const repositories = repo.listAll();
    return {
      repositories,
      total: repositories.length
    };
  });

  // POST /api/repos - Register repository
  fastify.post<{ Body: CreateRepoBody }>('/repos', async (request, reply) => {
    const { path: repoPath, name, defaultTargetBranch, defaultWorkingDir } = request.body;

    // Validate path is a git repository
    const gitInfo = getGitInfo(repoPath);
    if (!gitInfo) {
      return reply.status(400).send({ error: 'Path is not a git repository' });
    }

    const resolvedPath = path.resolve(repoPath);
    const displayName = name ?? path.basename(resolvedPath);

    const repo = getRepo();
    const created = repo.findOrCreate(resolvedPath, displayName);

    // Apply optional fields via update if provided
    if (defaultTargetBranch || defaultWorkingDir) {
      const updatePayload: UpdateRepo = {};
      if (defaultTargetBranch) updatePayload.defaultTargetBranch = defaultTargetBranch;
      if (defaultWorkingDir) updatePayload.defaultWorkingDir = defaultWorkingDir;
      const updated = repo.update(created.id, updatePayload);
      if (updated) {
        fastify.log.info(`Repository registered: ${updated.id} (${updated.path})`);
        return reply.status(201).send(updated);
      }
    }

    fastify.log.info(`Repository registered: ${created.id} (${created.path})`);
    return reply.status(201).send(created);
  });

  // POST /api/repos/init - Initialize new repository
  fastify.post<{ Body: InitRepoBody }>('/repos/init', async (request, reply) => {
    const { path: repoPath, name, remote } = request.body;

    const resolvedPath = path.resolve(repoPath);

    try {
      // Initialize git repo
      execSync('git init', { cwd: resolvedPath, stdio: 'ignore' });

      // Add remote if provided
      if (remote) {
        execSync(`git remote add origin ${remote}`, { cwd: resolvedPath, stdio: 'ignore' });
      }

      const displayName = name ?? path.basename(resolvedPath);

      const repo = getRepo();
      const created = repo.findOrCreate(resolvedPath, displayName);

      fastify.log.info(`Repository initialized: ${created.id} (${resolvedPath})`);

      return reply.status(201).send(created);
    } catch (err: any) {
      fastify.log.error(`Failed to init repo at ${resolvedPath}:`, err);
      return reply.status(500).send({ error: 'Failed to initialize repository' });
    }
  });

  // POST /api/repos/batch - Get repositories by IDs
  fastify.post<{ Body: { ids: string[] } }>('/repos/batch', async (request) => {
    const { ids } = request.body;
    const repo = getRepo();
    const repos = repo.findByIds(ids);

    return {
      repositories: repos,
      total: repos.length
    };
  });

  // GET /api/repos/:repoId - Get repository
  fastify.get<{ Params: { repoId: string } }>('/repos/:repoId', async (request, reply) => {
    const { repoId } = request.params;
    const repo = getRepo();
    const found = repo.findById(repoId);

    if (!found) {
      return reply.status(404).send({ error: 'Repository not found' });
    }

    // Get current git status
    const gitInfo = getGitInfo(found.path);

    return {
      ...found,
      currentBranch: gitInfo?.branch,
      isDirty: gitInfo?.isDirty ?? false
    };
  });

  // PUT /api/repos/:repoId - Update repository
  fastify.put<{ Params: { repoId: string }; Body: UpdateRepoBody }>(
    '/repos/:repoId',
    async (request, reply) => {
      const { repoId } = request.params;
      const updates = request.body;

      const repo = getRepo();

      // Map UpdateRepoBody to UpdateRepo (DB type)
      const payload: UpdateRepo = {};
      if (updates.name !== undefined) payload.displayName = updates.name;
      if (updates.defaultTargetBranch !== undefined) payload.defaultTargetBranch = updates.defaultTargetBranch;
      if (updates.defaultWorkingDir !== undefined) payload.defaultWorkingDir = updates.defaultWorkingDir;

      const updated = repo.update(repoId, payload);
      if (!updated) {
        return reply.status(404).send({ error: 'Repository not found' });
      }

      return updated;
    }
  );

  // GET /api/repos/:repoId/branches - Get branches
  fastify.get<{ Params: { repoId: string } }>('/repos/:repoId/branches', async (request, reply) => {
    const { repoId } = request.params;
    const repo = getRepo();
    const found = repo.findById(repoId);

    if (!found) {
      return reply.status(404).send({ error: 'Repository not found' });
    }

    const branches = getBranches(found.path);

    return {
      branches,
      total: branches.length
    };
  });

  // GET /api/repos/:repoId/remotes - Get remotes
  fastify.get<{ Params: { repoId: string } }>('/repos/:repoId/remotes', async (request, reply) => {
    const { repoId } = request.params;
    const repo = getRepo();
    const found = repo.findById(repoId);

    if (!found) {
      return reply.status(404).send({ error: 'Repository not found' });
    }

    const remotes = getRemotes(found.path);

    return {
      remotes,
      total: remotes.length
    };
  });

  // GET /api/repos/:repoId/prs - List pull requests
  fastify.get<{ Params: { repoId: string }; Querystring: { remote?: string } }>(
    '/repos/:repoId/prs',
    async (request, reply) => {
      const { repoId } = request.params;
      const { remote = 'origin' } = request.query;

      const repo = getRepo();
      const found = repo.findById(repoId);
      if (!found) {
        return reply.status(404).send({ error: 'Repository not found' });
      }

      const prs = await getPullRequests(found.path, remote);

      return {
        pullRequests: prs,
        total: prs.length
      };
    }
  );

  // GET /api/repos/:repoId/search - Search repository files
  fastify.get<{ Params: { repoId: string }; Querystring: { q: string; mode?: string } }>(
    '/repos/:repoId/search',
    async (request, reply) => {
      const { repoId } = request.params;
      const { q, mode = 'filename' } = request.query;

      const repo = getRepo();
      const found = repo.findById(repoId);
      if (!found) {
        return reply.status(404).send({ error: 'Repository not found' });
      }

      const results = searchRepository(found.path, q, mode);

      return {
        query: q,
        mode,
        results,
        total: results.length
      };
    }
  );

  // POST /api/repos/:repoId/open-editor - Open in editor
  fastify.post<{ Params: { repoId: string }; Body: { editor?: string; file?: string } }>(
    '/repos/:repoId/open-editor',
    async (request, reply) => {
      const { repoId } = request.params;
      const { editor = 'vscode', file } = request.body;

      const repo = getRepo();
      const found = repo.findById(repoId);
      if (!found) {
        return reply.status(404).send({ error: 'Repository not found' });
      }

      const targetPath = file ? path.join(found.path, file) : found.path;

      try {
        openInEditor(targetPath, editor);
        return { success: true, path: targetPath, editor };
      } catch (err: any) {
        return reply.status(500).send({ error: 'Failed to open editor', details: err.message });
      }
    }
  );
};

// Helper functions
function getGitInfo(repoPath: string): { branch: string; remote?: string; isDirty: boolean } | null {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    let remote: string | undefined;
    try {
      remote = execSync('git remote get-url origin', {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
    } catch {
      // No remote
    }

    let isDirty = false;
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

    return { branch, remote, isDirty };
  } catch {
    return null;
  }
}

function getBranches(repoPath: string): Branch[] {
  const branches: Branch[] = [];

  try {
    const output = execSync('git branch -a --format="%(refname:short)|%(objectname:short)|%(HEAD)|%(upstream:short)"', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    for (const line of output.split('\n').filter(Boolean)) {
      const [name, commit, head, upstream] = line.split('|');
      if (!name) continue;

      branches.push({
        name: name.replace('remotes/', ''),
        commit: commit ?? '',
        isHead: head === '*',
        isRemote: name.startsWith('remotes/'),
        upstream: upstream || undefined
      });
    }
  } catch {
    // Return empty array
  }

  return branches;
}

function getRemotes(repoPath: string): Remote[] {
  const remotes: Remote[] = [];

  try {
    const output = execSync('git remote -v', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const remoteMap = new Map<string, Remote>();

    for (const line of output.split('\n').filter(Boolean)) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
      if (!match) continue;

      const [, name, url, type] = match;
      if (!name || !url) continue;

      let remote = remoteMap.get(name);
      if (!remote) {
        remote = { name, url };
        remoteMap.set(name, remote);
      }

      if (type === 'fetch') remote.fetchUrl = url;
      if (type === 'push') remote.pushUrl = url;
    }

    remotes.push(...remoteMap.values());
  } catch {
    // Return empty array
  }

  return remotes;
}

async function getPullRequests(repoPath: string, remote: string): Promise<PullRequest[]> {
  const prs: PullRequest[] = [];

  try {
    // Use GitHub CLI if available
    const output = execSync('gh pr list --json number,title,state,headRefName,baseRefName,url,author,createdAt,updatedAt', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const data = JSON.parse(output);
    for (const pr of data) {
      prs.push({
        number: pr.number,
        title: pr.title,
        state: pr.state.toLowerCase() as PullRequest['state'],
        headBranch: pr.headRefName,
        baseBranch: pr.baseRefName,
        url: pr.url,
        author: pr.author?.login ?? 'unknown',
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt
      });
    }
  } catch {
    // gh CLI not available or not a GitHub repo
  }

  return prs;
}

function searchRepository(repoPath: string, query: string, mode: string): Array<{ path: string; line?: number; content?: string }> {
  const results: Array<{ path: string; line?: number; content?: string }> = [];

  try {
    if (mode === 'content') {
      // Search file contents with git grep
      const output = execSync(`git grep -n "${query}"`, {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024
      });

      for (const line of output.split('\n').filter(Boolean).slice(0, 100)) {
        const match = line.match(/^([^:]+):(\d+):(.*)$/);
        if (match) {
          results.push({
            path: match[1] ?? '',
            line: parseInt(match[2] ?? '0', 10),
            content: match[3]
          });
        }
      }
    } else {
      // Search file names
      const output = execSync(`git ls-files "*${query}*"`, {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      for (const file of output.split('\n').filter(Boolean).slice(0, 100)) {
        results.push({ path: file });
      }
    }
  } catch {
    // Search failed
  }

  return results;
}

function openInEditor(targetPath: string, editor: string): void {
  const commands: Record<string, string> = {
    vscode: 'code',
    'vscode-insiders': 'code-insiders',
    cursor: 'cursor',
    zed: 'zed',
    windsurf: 'windsurf'
  };

  const command = commands[editor] ?? 'code';
  execSync(`${command} "${targetPath}"`, { stdio: 'ignore' });
}
