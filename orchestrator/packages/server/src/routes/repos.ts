/**
 * Repository routes
 * Translates: crates/server/src/routes/repo.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

// Types
export interface Repository {
  id: string;
  name: string;
  path: string;
  remote?: string;
  defaultBranch: string;
  defaultTargetBranch?: string;
  defaultWorkingDir?: string;
  createdAt: string;
  updatedAt: string;
}

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

// In-memory store
const repositories = new Map<string, Repository>();

export const repoRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/repos - List all repositories
  fastify.get('/repos', async () => {
    return {
      repositories: Array.from(repositories.values()),
      total: repositories.size
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

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const repo: Repository = {
      id,
      name: name ?? path.basename(repoPath),
      path: path.resolve(repoPath),
      remote: gitInfo.remote,
      defaultBranch: gitInfo.branch,
      defaultTargetBranch: defaultTargetBranch ?? gitInfo.branch,
      defaultWorkingDir,
      createdAt: now,
      updatedAt: now
    };

    repositories.set(id, repo);

    fastify.log.info(`Repository registered: ${id} (${repo.path})`);

    return reply.status(201).send(repo);
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

      // Get default branch
      let branch = 'main';
      try {
        branch = execSync('git config init.defaultBranch', {
          cwd: resolvedPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim() || 'main';
      } catch {
        // Use default
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      const repo: Repository = {
        id,
        name: name ?? path.basename(resolvedPath),
        path: resolvedPath,
        remote,
        defaultBranch: branch,
        defaultTargetBranch: branch,
        createdAt: now,
        updatedAt: now
      };

      repositories.set(id, repo);

      fastify.log.info(`Repository initialized: ${id} (${resolvedPath})`);

      return reply.status(201).send(repo);
    } catch (err: any) {
      fastify.log.error(`Failed to init repo at ${resolvedPath}:`, err);
      return reply.status(500).send({ error: 'Failed to initialize repository' });
    }
  });

  // POST /api/repos/batch - Get repositories by IDs
  fastify.post<{ Body: { ids: string[] } }>('/repos/batch', async (request) => {
    const { ids } = request.body;

    const repos = ids
      .map(id => repositories.get(id))
      .filter((r): r is Repository => r !== undefined);

    return {
      repositories: repos,
      total: repos.length
    };
  });

  // GET /api/repos/:repoId - Get repository
  fastify.get<{ Params: { repoId: string } }>('/repos/:repoId', async (request, reply) => {
    const { repoId } = request.params;
    const repo = repositories.get(repoId);

    if (!repo) {
      return reply.status(404).send({ error: 'Repository not found' });
    }

    // Get current git status
    const gitInfo = getGitInfo(repo.path);

    return {
      ...repo,
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

      const repo = repositories.get(repoId);
      if (!repo) {
        return reply.status(404).send({ error: 'Repository not found' });
      }

      const updatedRepo: Repository = {
        ...repo,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      repositories.set(repoId, updatedRepo);

      return updatedRepo;
    }
  );

  // GET /api/repos/:repoId/branches - Get branches
  fastify.get<{ Params: { repoId: string } }>('/repos/:repoId/branches', async (request, reply) => {
    const { repoId } = request.params;
    const repo = repositories.get(repoId);

    if (!repo) {
      return reply.status(404).send({ error: 'Repository not found' });
    }

    const branches = getBranches(repo.path);

    return {
      branches,
      total: branches.length
    };
  });

  // GET /api/repos/:repoId/remotes - Get remotes
  fastify.get<{ Params: { repoId: string } }>('/repos/:repoId/remotes', async (request, reply) => {
    const { repoId } = request.params;
    const repo = repositories.get(repoId);

    if (!repo) {
      return reply.status(404).send({ error: 'Repository not found' });
    }

    const remotes = getRemotes(repo.path);

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

      const repo = repositories.get(repoId);
      if (!repo) {
        return reply.status(404).send({ error: 'Repository not found' });
      }

      const prs = await getPullRequests(repo.path, remote);

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

      const repo = repositories.get(repoId);
      if (!repo) {
        return reply.status(404).send({ error: 'Repository not found' });
      }

      const results = searchRepository(repo.path, q, mode);

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

      const repo = repositories.get(repoId);
      if (!repo) {
        return reply.status(404).send({ error: 'Repository not found' });
      }

      const targetPath = file ? path.join(repo.path, file) : repo.path;

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

// Export helpers
export function getRepository(id: string): Repository | undefined {
  return repositories.get(id);
}

export function getAllRepositories(): Repository[] {
  return Array.from(repositories.values());
}
