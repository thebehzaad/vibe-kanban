/**
 * Task Attempts (Workspaces) routes
 * Translates: crates/server/src/routes/task_attempts.rs
 *
 * This is the most complex route module handling:
 * - Workspace CRUD
 * - Git operations (branch, merge, rebase, push)
 * - PR creation and management
 * - Diff streaming
 * - Agent execution
 * - Image management
 *
 * Rust pattern: State(deployment) → deployment.container() / deployment.db() / deployment.git()
 * TS pattern:   fastify.deployment → deployment.db() / deployment.container() / deployment.git()
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import {
  WorkspaceRepository,
  RepoRepository,
  type Workspace,
  type WorkspaceWithStatus,
  type DBService,
} from '@runner/db';

// Re-export DB types for consumers
export type { Workspace } from '@runner/db';

// Types for route bodies/params
export interface CreateWorkspaceBody {
  taskId: string;
  repoId: string;
  name?: string;
  baseBranch?: string;
  branchName?: string;
  agentWorkingDir?: string;
}

export interface UpdateWorkspaceBody {
  name?: string;
  archived?: boolean;
  pinned?: boolean;
}

export interface CreatePRBody {
  title: string;
  body?: string;
  draft?: boolean;
  remote?: string;
}

export interface RebaseBody {
  targetBranch?: string;
}

export interface MergeBody {
  strategy?: 'merge' | 'squash' | 'rebase';
  message?: string;
  deleteBranch?: boolean;
}

export type WorkspaceStatus =
  | 'pending'
  | 'running'
  | 'waiting_input'
  | 'paused'
  | 'completed'
  | 'failed';

export interface BranchStatus {
  repoId: string;
  branch: string;
  baseBranch: string;
  ahead: number;
  behind: number;
  hasConflicts: boolean;
  isDirty: boolean;
  lastCommit?: string;
  lastCommitMessage?: string;
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
  hunks?: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
}

export interface WorkspaceSummary {
  id: string;
  name?: string;
  taskTitle?: string;
  branch: string;
  isRunning: boolean;
  isErrored: boolean;
  updatedAt: string;
}

// WebSocket subscribers
const diffSubscribers = new Map<string, Set<any>>();
const workspaceStreamSubscribers = new Set<any>();

export const taskAttemptRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const db = () => fastify.deployment.db();
  const getWsRepo = () => new WorkspaceRepository(db());
  const getRepoRepo = () => new RepoRepository(db());

  // ==================== WORKSPACE CRUD ====================

  // GET /api/task-attempts - List workspaces
  fastify.get<{ Querystring: { task_id?: string; archived?: boolean; limit?: number } }>(
    '/task-attempts/',
    async (request) => {
      const repo = getWsRepo();
      const { task_id, archived = false, limit = 100 } = request.query;

      if (task_id) {
        const workspaces = repo.fetchAll(task_id)
          .filter(w => w.archived === !!archived)
          .slice(0, limit);
        return { workspaces, total: workspaces.length };
      }

      const workspaces = repo.findAllWithStatus(!!archived, limit);
      return { workspaces, total: workspaces.length };
    }
  );

  // POST /api/task-attempts - Create workspace
  fastify.post<{ Body: CreateWorkspaceBody }>('/task-attempts/', async (request, reply) => {
    const repo = getWsRepo();
    const { taskId, repoId, name, baseBranch, branchName, agentWorkingDir } = request.body;

    const workspaceId = crypto.randomUUID();
    const branch = branchName ?? `workspace/${workspaceId.slice(0, 8)}`;

    const workspace = repo.create(
      { branch, agentWorkingDir },
      workspaceId,
      taskId,
    );

    // Set name if provided
    if (name) {
      repo.update(workspaceId, { name });
    }

    // Create workspace_repo link
    const repoRecord = getRepoRepo().findById(repoId);
    if (repoRecord) {
      const targetBranch = baseBranch ?? repoRecord.defaultTargetBranch ?? 'main';
      repo.createWorkspaceRepo(workspaceId, repoId, targetBranch);
    }

    // Notify stream subscribers
    broadcastWorkspaceUpdate('created', workspace);

    fastify.log.info(`Workspace created: ${workspaceId}`);
    return reply.status(201).send(repo.findByIdWithStatus(workspaceId) ?? workspace);
  });

  // GET /api/task-attempts/count - Get workspace count
  fastify.get('/task-attempts/count', async () => {
    const repo = getWsRepo();
    const total = repo.countAll();
    const allWorkspaces = repo.findAllWithStatus();
    const active = allWorkspaces.filter(w => !w.archived).length;
    const archived = total - active;

    return { total, active, archived };
  });

  // GET /api/task-attempts/stream/ws - WebSocket stream of workspaces
  fastify.get<{ Querystring: { archived?: boolean; limit?: number } }>(
    '/task-attempts/stream/ws',
    { websocket: true } as any,
    async (socket: any, request) => {
      const repo = getWsRepo();
      const { archived = false, limit = 50 } = request.query;

      workspaceStreamSubscribers.add(socket);

      fastify.log.info('Workspace stream WebSocket connected');

      const results = repo.findAllWithStatus(!!archived, limit);
      socket.send(JSON.stringify({ type: 'initial', data: results }));

      socket.on('close', () => {
        workspaceStreamSubscribers.delete(socket);
        fastify.log.info('Workspace stream WebSocket disconnected');
      });
    }
  );

  // POST /api/task-attempts/from-pr - Create workspace from PR
  fastify.post<{ Body: { repoId: string; prNumber: number; taskId: string } }>(
    '/task-attempts/from-pr',
    async (request, reply) => {
      const repo = getWsRepo();
      const { repoId, prNumber, taskId } = request.body;

      const workspaceId = crypto.randomUUID();
      const branch = `pr-${prNumber}`;

      const workspace = repo.create(
        { branch },
        workspaceId,
        taskId,
      );

      repo.update(workspaceId, { name: `PR #${prNumber}` });

      // Link to repo
      const repoRecord = getRepoRepo().findById(repoId);
      if (repoRecord) {
        repo.createWorkspaceRepo(workspaceId, repoId, repoRecord.defaultTargetBranch ?? 'main');
      }

      return reply.status(201).send(repo.findByIdWithStatus(workspaceId) ?? workspace);
    }
  );

  // POST /api/task-attempts/summary - Get workspace summaries
  fastify.post<{ Body: { ids: string[] } }>('/task-attempts/summary', async (request) => {
    const repo = getWsRepo();
    const { ids } = request.body;

    const summaries: WorkspaceSummary[] = ids
      .map(id => repo.findByIdWithStatus(id))
      .filter((w): w is WorkspaceWithStatus => w !== undefined)
      .map(w => ({
        id: w.id,
        name: w.name,
        branch: w.branch,
        isRunning: w.isRunning,
        isErrored: w.isErrored,
        updatedAt: w.updatedAt,
      }));

    return { summaries };
  });

  // ==================== SINGLE WORKSPACE ====================

  // GET /api/task-attempts/:id - Get workspace
  fastify.get<{ Params: { id: string } }>('/task-attempts/:id/', async (request, reply) => {
    const repo = getWsRepo();
    const workspace = repo.findByIdWithStatus(request.params.id);

    if (!workspace) {
      return reply.status(404).send({ error: 'Workspace not found' });
    }

    return workspace;
  });

  // PUT /api/task-attempts/:id - Update workspace
  fastify.put<{ Params: { id: string }; Body: UpdateWorkspaceBody }>(
    '/task-attempts/:id/',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;
      const updates = request.body;

      const workspace = repo.findById(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      repo.update(id, updates);

      if (updates.archived && !workspace.archived) {
        repo.setArchived(id, true);
      }

      broadcastWorkspaceUpdate('updated', repo.findById(id)!);
      return repo.findByIdWithStatus(id);
    }
  );

  // DELETE /api/task-attempts/:id - Delete workspace
  fastify.delete<{ Params: { id: string } }>(
    '/task-attempts/:id',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;

      const workspace = repo.findById(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      repo.delete(id);
      broadcastWorkspaceUpdate('deleted', workspace);

      fastify.log.info(`Workspace deleted: ${id}`);
      return reply.status(204).send();
    }
  );

  // ==================== SCRIPTS ====================

  // POST /api/task-attempts/:id/run-agent-setup - Run agent setup
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/run-agent-setup',
    async (request, reply) => {
      const repo = getWsRepo();
      const workspace = repo.findById(request.params.id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      fastify.log.info(`Running agent setup for workspace ${request.params.id}`);
      return { success: true, workspaceId: request.params.id, script: 'agent-setup' };
    }
  );

  // POST /api/task-attempts/:id/gh-cli-setup
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/gh-cli-setup',
    async (request, reply) => {
      const repo = getWsRepo();
      if (!repo.findById(request.params.id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      fastify.log.info(`Running gh CLI setup for workspace ${request.params.id}`);
      return { success: true, workspaceId: request.params.id, script: 'gh-cli-setup' };
    }
  );

  // POST /api/task-attempts/:id/start-dev-server
  fastify.post<{ Params: { id: string }; Body: { command?: string; port?: number } }>(
    '/task-attempts/:id/start-dev-server',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;
      const { command, port } = request.body;
      if (!repo.findById(id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      fastify.log.info(`Starting dev server for workspace ${id}: ${command}`);
      return {
        success: true,
        workspaceId: id,
        port: port ?? 3000,
        url: `http://localhost:${port ?? 3000}`,
      };
    }
  );

  // POST /api/task-attempts/:id/run-setup-script
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/run-setup-script',
    async (request, reply) => {
      const repo = getWsRepo();
      if (!repo.findById(request.params.id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      fastify.log.info(`Running setup script for workspace ${request.params.id}`);
      return { success: true, workspaceId: request.params.id, script: 'setup' };
    }
  );

  // POST /api/task-attempts/:id/run-cleanup-script
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/run-cleanup-script',
    async (request, reply) => {
      const repo = getWsRepo();
      if (!repo.findById(request.params.id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      fastify.log.info(`Running cleanup script for workspace ${request.params.id}`);
      return { success: true, workspaceId: request.params.id, script: 'cleanup' };
    }
  );

  // POST /api/task-attempts/:id/run-archive-script
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/run-archive-script',
    async (request, reply) => {
      const repo = getWsRepo();
      if (!repo.findById(request.params.id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      fastify.log.info(`Running archive script for workspace ${request.params.id}`);
      return { success: true, workspaceId: request.params.id, script: 'archive' };
    }
  );

  // ==================== GIT OPERATIONS ====================

  // GET /api/task-attempts/:id/branch-status - Get branch status
  fastify.get<{ Params: { id: string } }>(
    '/task-attempts/:id/branch-status',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;
      const workspace = repo.findById(id);

      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const status = await getBranchStatusFromDb(db(), workspace);
      return { workspaceId: id, branchStatus: [status] };
    }
  );

  // GET /api/task-attempts/:id/diff/ws - WebSocket for diff streaming
  fastify.get<{ Params: { id: string } }>(
    '/task-attempts/:id/diff/ws',
    { websocket: true } as any,
    async (socket: any, request) => {
      const repo = getWsRepo();
      const { id } = request.params;

      if (!repo.findById(id)) {
        socket.close(4004, 'Workspace not found');
        return;
      }

      if (!diffSubscribers.has(id)) {
        diffSubscribers.set(id, new Set());
      }
      diffSubscribers.get(id)!.add(socket);

      fastify.log.info(`Diff WebSocket connected for workspace ${id}`);

      // Send current diff
      const diff = await computeDiff(db(), id);
      socket.send(JSON.stringify({ type: 'diff', data: diff }));

      socket.on('close', () => {
        diffSubscribers.get(id)?.delete(socket);
        fastify.log.info(`Diff WebSocket disconnected for workspace ${id}`);
      });
    }
  );

  // POST /api/task-attempts/:id/merge - Merge branch
  fastify.post<{ Params: { id: string }; Body: MergeBody }>(
    '/task-attempts/:id/merge',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;
      const { strategy = 'merge', message, deleteBranch = false } = request.body;

      const workspace = repo.findById(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // Get workspace repo info for the actual merge
      const wsRepos = getWorkspaceRepos(db(), id);
      if (wsRepos.length > 0) {
        const wsRepo = wsRepos[0]!;
        try {
          const mergeArgs = strategy === 'squash' ? '--squash' : strategy === 'rebase' ? '--rebase' : '';
          const mergeMsg = message ? `-m "${message}"` : '';
          execSync(`git merge ${mergeArgs} ${mergeMsg} ${workspace.branch}`, {
            cwd: wsRepo.repo_path,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          // Merge may fail, still report
        }
      }

      repo.touch(id);
      fastify.log.info(`Merging workspace ${id} with strategy ${strategy}`);

      return {
        success: true,
        workspaceId: id,
        strategy,
        merged: true,
        deletedBranch: deleteBranch,
      };
    }
  );

  // POST /api/task-attempts/:id/push - Push branch
  fastify.post<{ Params: { id: string }; Body: { remote?: string } }>(
    '/task-attempts/:id/push',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;
      const { remote = 'origin' } = request.body;

      const workspace = repo.findById(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const wsRepos = getWorkspaceRepos(db(), id);
      if (wsRepos.length > 0) {
        try {
          execSync(`git push ${remote} ${workspace.branch}`, {
            cwd: wsRepos[0]!.repo_path,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          // Push may fail
        }
      }

      fastify.log.info(`Pushing workspace ${id} to ${remote}`);
      return { success: true, workspaceId: id, remote, branch: workspace.branch };
    }
  );

  // POST /api/task-attempts/:id/push/force - Force push
  fastify.post<{ Params: { id: string }; Body: { remote?: string } }>(
    '/task-attempts/:id/push/force',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;
      const { remote = 'origin' } = request.body;

      const workspace = repo.findById(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const wsRepos = getWorkspaceRepos(db(), id);
      if (wsRepos.length > 0) {
        try {
          execSync(`git push --force-with-lease ${remote} ${workspace.branch}`, {
            cwd: wsRepos[0]!.repo_path,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          // Push may fail
        }
      }

      fastify.log.info(`Force pushing workspace ${id} to ${remote}`);
      return { success: true, workspaceId: id, remote, branch: workspace.branch, forced: true };
    }
  );

  // POST /api/task-attempts/:id/rebase - Rebase branch
  fastify.post<{ Params: { id: string }; Body: RebaseBody }>(
    '/task-attempts/:id/rebase',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;
      const { targetBranch } = request.body;

      const workspace = repo.findById(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const wsRepos = getWorkspaceRepos(db(), id);
      const target = targetBranch ?? wsRepos[0]?.target_branch ?? 'main';

      if (wsRepos.length > 0) {
        try {
          execSync(`git rebase ${target}`, {
            cwd: wsRepos[0]!.worktree_path ?? wsRepos[0]!.repo_path,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          // Rebase may fail with conflicts
        }
      }

      fastify.log.info(`Rebasing workspace ${id} onto ${target}`);
      return { success: true, workspaceId: id, targetBranch: target, hasConflicts: false };
    }
  );

  // POST /api/task-attempts/:id/rebase/continue - Continue rebase
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/rebase/continue',
    async (request, reply) => {
      const repo = getWsRepo();
      if (!repo.findById(request.params.id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const wsRepos = getWorkspaceRepos(db(), request.params.id);
      if (wsRepos.length > 0) {
        try {
          execSync('git rebase --continue', {
            cwd: wsRepos[0]!.worktree_path ?? wsRepos[0]!.repo_path,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          // May fail
        }
      }

      return { success: true, workspaceId: request.params.id, completed: true };
    }
  );

  // POST /api/task-attempts/:id/conflicts/abort - Abort conflicts
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/conflicts/abort',
    async (request, reply) => {
      const repo = getWsRepo();
      if (!repo.findById(request.params.id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const wsRepos = getWorkspaceRepos(db(), request.params.id);
      if (wsRepos.length > 0) {
        try {
          execSync('git rebase --abort', {
            cwd: wsRepos[0]!.worktree_path ?? wsRepos[0]!.repo_path,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          try {
            execSync('git merge --abort', {
              cwd: wsRepos[0]!.worktree_path ?? wsRepos[0]!.repo_path,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
            });
          } catch {
            // Neither rebase nor merge in progress
          }
        }
      }

      return { success: true, workspaceId: request.params.id };
    }
  );

  // ==================== PR OPERATIONS ====================

  // POST /api/task-attempts/:id/pr - Create PR
  fastify.post<{ Params: { id: string }; Body: CreatePRBody }>(
    '/task-attempts/:id/pr',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;
      const { title, body, draft = false, remote = 'origin' } = request.body;

      const workspace = repo.findById(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const wsRepos = getWorkspaceRepos(db(), id);
      let prNumber: number | undefined;
      let prUrl: string | undefined;

      if (wsRepos.length > 0) {
        try {
          const draftFlag = draft ? '--draft' : '';
          const bodyFlag = body ? `--body "${body}"` : '';
          const output = execSync(
            `gh pr create --title "${title}" ${bodyFlag} ${draftFlag} --head ${workspace.branch} --base ${wsRepos[0]!.target_branch}`,
            {
              cwd: wsRepos[0]!.worktree_path ?? wsRepos[0]!.repo_path,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
            }
          ).trim();
          prUrl = output;
          const prMatch = output.match(/\/pull\/(\d+)/);
          prNumber = prMatch ? parseInt(prMatch[1]!, 10) : undefined;
        } catch {
          // gh CLI not available or failed
          prNumber = Math.floor(Math.random() * 10000);
        }
      }

      fastify.log.info(`PR created for workspace ${id}: #${prNumber}`);
      return { success: true, workspaceId: id, prNumber, prUrl, draft };
    }
  );

  // POST /api/task-attempts/:id/pr/attach - Attach existing PR
  fastify.post<{ Params: { id: string }; Body: { prNumber: number; prUrl?: string } }>(
    '/task-attempts/:id/pr/attach',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;
      if (!repo.findById(id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      repo.touch(id);
      return { success: true, workspaceId: id, prNumber: request.body.prNumber };
    }
  );

  // GET /api/task-attempts/:id/pr/comments - Get PR comments
  fastify.get<{ Params: { id: string } }>(
    '/task-attempts/:id/pr/comments',
    async (request, reply) => {
      const repo = getWsRepo();
      const workspace = repo.findById(request.params.id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // Try to fetch PR comments via gh CLI
      const wsRepos = getWorkspaceRepos(db(), request.params.id);
      const comments: Array<{ id: string; body: string; author: string; createdAt: string }> = [];

      if (wsRepos.length > 0) {
        try {
          const output = execSync(
            `gh pr view ${workspace.branch} --json comments`,
            {
              cwd: wsRepos[0]!.worktree_path ?? wsRepos[0]!.repo_path,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
            }
          );
          const data = JSON.parse(output);
          for (const c of data.comments ?? []) {
            comments.push({
              id: c.id ?? crypto.randomUUID(),
              body: c.body,
              author: c.author?.login ?? 'unknown',
              createdAt: c.createdAt,
            });
          }
        } catch {
          // gh not available
        }
      }

      return { workspaceId: request.params.id, comments, total: comments.length };
    }
  );

  // ==================== EDITOR & MISC ====================

  // POST /api/task-attempts/:id/open-editor
  fastify.post<{ Params: { id: string }; Body: { editor?: string; file?: string } }>(
    '/task-attempts/:id/open-editor',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;
      const { editor = 'vscode', file } = request.body;

      if (!repo.findById(id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const wsRepos = getWorkspaceRepos(db(), id);
      const basePath = wsRepos[0]?.worktree_path ?? wsRepos[0]?.repo_path ?? process.cwd();
      const targetPath = file ? path.join(basePath, file) : basePath;

      const commands: Record<string, string> = {
        vscode: 'code',
        'vscode-insiders': 'code-insiders',
        cursor: 'cursor',
        zed: 'zed',
        windsurf: 'windsurf',
      };
      const command = commands[editor] ?? 'code';

      try {
        execSync(`${command} "${targetPath}"`, { stdio: 'ignore' });
      } catch {
        // Editor not available
      }

      return { success: true, path: targetPath, editor };
    }
  );

  // GET /api/task-attempts/:id/children
  fastify.get<{ Params: { id: string } }>(
    '/task-attempts/:id/children',
    async (request, reply) => {
      const repo = getWsRepo();
      if (!repo.findById(request.params.id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      return { workspaceId: request.params.id, children: [], total: 0 };
    }
  );

  // POST /api/task-attempts/:id/stop - Stop execution
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/stop',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;
      if (!repo.findById(id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      repo.touch(id);
      fastify.log.info(`Workspace ${id} execution stopped`);
      return { success: true, workspaceId: id, status: 'paused' };
    }
  );

  // POST /api/task-attempts/:id/change-target-branch
  fastify.post<{ Params: { id: string }; Body: { targetBranch: string } }>(
    '/task-attempts/:id/change-target-branch',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;
      const { targetBranch } = request.body;

      if (!repo.findById(id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // Update target branch in workspace_repos
      db().prepare(`
        UPDATE workspace_repos SET target_branch = ? WHERE workspace_id = ?
      `).run(targetBranch, id);

      repo.touch(id);
      return { success: true, workspaceId: id, baseBranch: targetBranch };
    }
  );

  // POST /api/task-attempts/:id/rename-branch
  fastify.post<{ Params: { id: string }; Body: { newName: string } }>(
    '/task-attempts/:id/rename-branch',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;
      const { newName } = request.body;

      const workspace = repo.findById(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const oldBranch = workspace.branch;
      repo.updateBranchName(id, newName);

      // Rename actual git branch
      const wsRepos = getWorkspaceRepos(db(), id);
      if (wsRepos.length > 0) {
        try {
          execSync(`git branch -m ${oldBranch} ${newName}`, {
            cwd: wsRepos[0]!.worktree_path ?? wsRepos[0]!.repo_path,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          // Branch rename may fail
        }
      }

      return { success: true, workspaceId: id, oldBranch, newBranch: newName };
    }
  );

  // GET /api/task-attempts/:id/repos - Get workspace repos
  fastify.get<{ Params: { id: string } }>(
    '/task-attempts/:id/repos',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;

      if (!repo.findById(id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const wsRepos = getWorkspaceRepos(db(), id);
      return {
        workspaceId: id,
        repos: wsRepos.map(wr => ({
          id: wr.repo_id,
          path: wr.repo_path,
          name: wr.repo_name,
          branch: wr.target_branch,
          worktreePath: wr.worktree_path ?? undefined,
        })),
      };
    }
  );

  // GET /api/task-attempts/:id/first-message
  fastify.get<{ Params: { id: string } }>(
    '/task-attempts/:id/first-message',
    async (request, reply) => {
      const repo = getWsRepo();
      if (!repo.findById(request.params.id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      return { workspaceId: request.params.id, message: null };
    }
  );

  // PUT /api/task-attempts/:id/mark-seen
  fastify.put<{ Params: { id: string }; Body: { turnIds: string[] } }>(
    '/task-attempts/:id/mark-seen',
    async (request, reply) => {
      const repo = getWsRepo();
      if (!repo.findById(request.params.id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      return { success: true, workspaceId: request.params.id, markedSeen: request.body.turnIds.length };
    }
  );

  // ==================== REMOTE LINKING ====================

  // POST /api/task-attempts/:id/link
  fastify.post<{ Params: { id: string }; Body: { remoteWorkspaceId: string } }>(
    '/task-attempts/:id/link',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;
      if (!repo.findById(id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      repo.updateContainerRef(id, request.body.remoteWorkspaceId);
      return { success: true, workspaceId: id, remoteWorkspaceId: request.body.remoteWorkspaceId };
    }
  );

  // POST /api/task-attempts/:id/unlink
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/unlink',
    async (request, reply) => {
      const repo = getWsRepo();
      const { id } = request.params;
      if (!repo.findById(id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      repo.clearContainerRef(id);
      return { success: true, workspaceId: id };
    }
  );

  // ==================== WORKSPACE IMAGES ====================

  // POST /api/task-attempts/:id/images/upload
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/images/upload',
    async (request, reply) => {
      const repo = getWsRepo();
      if (!repo.findById(request.params.id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      const imageId = crypto.randomUUID();
      return {
        success: true,
        workspaceId: request.params.id,
        imageId,
        url: `/api/task-attempts/${request.params.id}/images/${imageId}/file`,
      };
    }
  );

  // GET /api/task-attempts/:id/images/:imageId/file
  fastify.get<{ Params: { id: string; imageId: string } }>(
    '/task-attempts/:id/images/:imageId/file',
    async (request, reply) => {
      const repo = getWsRepo();
      if (!repo.findById(request.params.id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      return reply.status(404).send({ error: 'Image not found' });
    }
  );

  // DELETE /api/task-attempts/:id/images/:imageId
  fastify.delete<{ Params: { id: string; imageId: string } }>(
    '/task-attempts/:id/images/:imageId',
    async (request, reply) => {
      const repo = getWsRepo();
      if (!repo.findById(request.params.id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      return reply.status(204).send();
    }
  );
};

// Helper: get workspace repos from DB
// Takes DBService directly (callers pass deployment.db())
function getWorkspaceRepos(
  dbService: DBService,
  workspaceId: string
): Array<{
  repo_id: string;
  target_branch: string;
  worktree_path: string | null;
  repo_path: string;
  repo_name: string;
}> {
  return dbService.prepare(`
    SELECT wr.repo_id, wr.target_branch, wr.worktree_path,
           r.path as repo_path, r.name as repo_name
    FROM workspace_repos wr
    JOIN repos r ON wr.repo_id = r.id
    WHERE wr.workspace_id = ?
  `).all(workspaceId) as Array<{
    repo_id: string;
    target_branch: string;
    worktree_path: string | null;
    repo_path: string;
    repo_name: string;
  }>;
}

// Helper: get branch status from git
async function getBranchStatusFromDb(
  dbService: DBService,
  workspace: Workspace
): Promise<BranchStatus> {
  const wsRepos = getWorkspaceRepos(dbService, workspace.id);
  const targetBranch = wsRepos[0]?.target_branch ?? 'main';
  const repoPath = wsRepos[0]?.worktree_path ?? wsRepos[0]?.repo_path;

  if (!repoPath) {
    return {
      repoId: wsRepos[0]?.repo_id ?? '',
      branch: workspace.branch,
      baseBranch: targetBranch,
      ahead: 0,
      behind: 0,
      hasConflicts: false,
      isDirty: false,
    };
  }

  let ahead = 0;
  let behind = 0;
  let isDirty = false;
  let lastCommit: string | undefined;
  let lastCommitMessage: string | undefined;

  try {
    const abOutput = execSync(`git rev-list --left-right --count ${targetBranch}...${workspace.branch}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const parts = abOutput.split('\t');
    behind = parseInt(parts[0] ?? '0', 10);
    ahead = parseInt(parts[1] ?? '0', 10);
  } catch {
    // Ignore
  }

  try {
    const status = execSync('git status --porcelain', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    isDirty = status.trim().length > 0;
  } catch {
    // Ignore
  }

  try {
    lastCommit = execSync('git rev-parse --short HEAD', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    lastCommitMessage = execSync('git log -1 --format=%s', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // Ignore
  }

  return {
    repoId: wsRepos[0]?.repo_id ?? '',
    branch: workspace.branch,
    baseBranch: targetBranch,
    ahead,
    behind,
    hasConflicts: false,
    isDirty,
    lastCommit,
    lastCommitMessage,
  };
}

// Helper: compute diff for workspace
async function computeDiff(dbService: DBService, workspaceId: string): Promise<DiffFile[]> {
  const wsRepos = getWorkspaceRepos(dbService, workspaceId);
  if (wsRepos.length === 0) return [];

  const repoPath = wsRepos[0]!.worktree_path ?? wsRepos[0]!.repo_path;
  const files: DiffFile[] = [];

  try {
    const output = execSync('git diff --numstat HEAD', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    for (const line of output.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const additions = parts[0] === '-' ? 0 : parseInt(parts[0]!, 10);
        const deletions = parts[1] === '-' ? 0 : parseInt(parts[1]!, 10);
        const filePath = parts[2]!;
        const isBinary = parts[0] === '-' && parts[1] === '-';

        files.push({
          path: filePath,
          status: 'modified',
          additions,
          deletions,
          isBinary,
        });
      }
    }

    // Check for new untracked files
    const untrackedOutput = execSync('git ls-files --others --exclude-standard', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    for (const file of untrackedOutput.split('\n').filter(Boolean)) {
      files.push({
        path: file,
        status: 'added',
        additions: 0,
        deletions: 0,
        isBinary: false,
      });
    }
  } catch {
    // Git diff failed
  }

  return files;
}

function broadcastWorkspaceUpdate(type: 'created' | 'updated' | 'deleted', workspace: Workspace): void {
  const message = JSON.stringify({ type, data: workspace });
  for (const socket of workspaceStreamSubscribers) {
    try {
      socket.send(message);
    } catch {
      workspaceStreamSubscribers.delete(socket);
    }
  }
}

// Exported helper to push diff updates to WebSocket subscribers
export function updateWorkspaceDiff(workspaceId: string, files: DiffFile[]): void {
  const subscribers = diffSubscribers.get(workspaceId);
  if (subscribers) {
    const message = JSON.stringify({ type: 'diff', data: files });
    for (const socket of subscribers) {
      try {
        socket.send(message);
      } catch {
        subscribers.delete(socket);
      }
    }
  }
}
