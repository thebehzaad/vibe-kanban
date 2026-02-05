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
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { emitEvent } from './events.js';

// Types
export interface Workspace {
  id: string;
  taskId: string;
  projectId: string;
  name: string;
  description?: string;
  status: WorkspaceStatus;
  archived: boolean;
  pinned: boolean;

  // Git info
  repoId: string;
  repoPath: string;
  branch: string;
  baseBranch: string;
  worktreePath?: string;

  // PR info
  prNumber?: number;
  prUrl?: string;
  prState?: 'open' | 'closed' | 'merged';

  // Remote linking
  remoteWorkspaceId?: string;

  // Timestamps
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
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
  name: string;
  taskTitle?: string;
  status: WorkspaceStatus;
  branch: string;
  prNumber?: number;
  prState?: string;
  updatedAt: string;
}

export interface CreateWorkspaceBody {
  taskId: string;
  projectId: string;
  repoId: string;
  name?: string;
  baseBranch?: string;
  branchName?: string;
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

// In-memory stores
const workspaces = new Map<string, Workspace>();
const workspaceDiffs = new Map<string, DiffFile[]>();

// WebSocket subscribers
const diffSubscribers = new Map<string, Set<any>>();
const workspaceStreamSubscribers = new Set<any>();

export const taskAttemptRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // ==================== WORKSPACE CRUD ====================

  // GET /api/task-attempts - List workspaces
  fastify.get<{ Querystring: { task_id?: string; archived?: boolean; limit?: number } }>(
    '/task-attempts/',
    async (request) => {
      const { task_id, archived = false, limit = 100 } = request.query;

      let results = Array.from(workspaces.values());

      if (task_id) {
        results = results.filter(w => w.taskId === task_id);
      }

      results = results.filter(w => w.archived === archived);

      // Sort by updatedAt desc
      results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      results = results.slice(0, limit);

      return {
        workspaces: results,
        total: results.length
      };
    }
  );

  // POST /api/task-attempts - Create workspace
  fastify.post<{ Body: CreateWorkspaceBody }>('/task-attempts/', async (request, reply) => {
    const { taskId, projectId, repoId, name, baseBranch, branchName } = request.body;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const branch = branchName ?? `workspace/${id.slice(0, 8)}`;

    // TODO: Get actual repo path from repos store
    const repoPath = `/path/to/repo`;

    const workspace: Workspace = {
      id,
      taskId,
      projectId,
      name: name ?? `Workspace ${id.slice(0, 8)}`,
      status: 'pending',
      archived: false,
      pinned: false,
      repoId,
      repoPath,
      branch,
      baseBranch: baseBranch ?? 'main',
      createdAt: now,
      updatedAt: now
    };

    workspaces.set(id, workspace);
    workspaceDiffs.set(id, []);

    // Emit event
    emitEvent('workspace.created', { workspaceId: id, taskId, projectId });

    // Notify stream subscribers
    broadcastWorkspaceUpdate('created', workspace);

    fastify.log.info(`Workspace created: ${id}`);

    return reply.status(201).send(workspace);
  });

  // GET /api/task-attempts/count - Get workspace count
  fastify.get('/task-attempts/count', async () => {
    const total = workspaces.size;
    const active = Array.from(workspaces.values()).filter(w => !w.archived).length;
    const archived = total - active;

    return { total, active, archived };
  });

  // GET /api/task-attempts/stream/ws - WebSocket stream of workspaces
  fastify.get<{ Querystring: { archived?: boolean; limit?: number } }>(
    '/task-attempts/stream/ws',
    { websocket: true } as any,
    async (socket: any, request) => {
      const { archived = false, limit = 50 } = request.query;

      workspaceStreamSubscribers.add(socket);

      fastify.log.info('Workspace stream WebSocket connected');

      // Send initial workspaces
      let results = Array.from(workspaces.values())
        .filter(w => w.archived === archived)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, limit);

      socket.send(JSON.stringify({ type: 'initial', data: results }));

      socket.on('close', () => {
        workspaceStreamSubscribers.delete(socket);
        fastify.log.info('Workspace stream WebSocket disconnected');
      });
    }
  );

  // POST /api/task-attempts/from-pr - Create workspace from PR
  fastify.post<{ Body: { repoId: string; prNumber: number; projectId: string; taskId?: string } }>(
    '/task-attempts/from-pr',
    async (request, reply) => {
      const { repoId, prNumber, projectId, taskId } = request.body;

      // TODO: Fetch PR info from GitHub
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      const workspace: Workspace = {
        id,
        taskId: taskId ?? crypto.randomUUID(),
        projectId,
        name: `PR #${prNumber}`,
        status: 'pending',
        archived: false,
        pinned: false,
        repoId,
        repoPath: '/path/to/repo',
        branch: `pr-${prNumber}`,
        baseBranch: 'main',
        prNumber,
        prState: 'open',
        createdAt: now,
        updatedAt: now
      };

      workspaces.set(id, workspace);
      workspaceDiffs.set(id, []);

      return reply.status(201).send(workspace);
    }
  );

  // POST /api/task-attempts/summary - Get workspace summaries
  fastify.post<{ Body: { ids: string[] } }>('/task-attempts/summary', async (request) => {
    const { ids } = request.body;

    const summaries: WorkspaceSummary[] = ids
      .map(id => workspaces.get(id))
      .filter((w): w is Workspace => w !== undefined)
      .map(w => ({
        id: w.id,
        name: w.name,
        status: w.status,
        branch: w.branch,
        prNumber: w.prNumber,
        prState: w.prState,
        updatedAt: w.updatedAt
      }));

    return { summaries };
  });

  // ==================== SINGLE WORKSPACE ====================

  // GET /api/task-attempts/:id - Get workspace
  fastify.get<{ Params: { id: string } }>('/task-attempts/:id/', async (request, reply) => {
    const { id } = request.params;
    const workspace = workspaces.get(id);

    if (!workspace) {
      return reply.status(404).send({ error: 'Workspace not found' });
    }

    return workspace;
  });

  // PUT /api/task-attempts/:id - Update workspace
  fastify.put<{ Params: { id: string }; Body: UpdateWorkspaceBody }>(
    '/task-attempts/:id/',
    async (request, reply) => {
      const { id } = request.params;
      const updates = request.body;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const updatedWorkspace: Workspace = {
        ...workspace,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      if (updates.archived && !workspace.archived) {
        updatedWorkspace.archivedAt = new Date().toISOString();
        emitEvent('workspace.archived', { workspaceId: id });
      }

      workspaces.set(id, updatedWorkspace);
      broadcastWorkspaceUpdate('updated', updatedWorkspace);

      return updatedWorkspace;
    }
  );

  // DELETE /api/task-attempts/:id - Delete workspace
  fastify.delete<{ Params: { id: string }; Querystring: { delete_remote?: boolean } }>(
    '/task-attempts/:id',
    async (request, reply) => {
      const { id } = request.params;
      const { delete_remote = false } = request.query;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Delete worktree if exists
      // TODO: Delete remote workspace if linked and delete_remote is true

      workspaces.delete(id);
      workspaceDiffs.delete(id);

      emitEvent('workspace.deleted', { workspaceId: id });
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
      const { id } = request.params;
      const workspace = workspaces.get(id);

      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Execute agent setup script
      fastify.log.info(`Running agent setup for workspace ${id}`);

      return { success: true, workspaceId: id, script: 'agent-setup' };
    }
  );

  // POST /api/task-attempts/:id/gh-cli-setup - Run GitHub CLI setup
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/gh-cli-setup',
    async (request, reply) => {
      const { id } = request.params;
      const workspace = workspaces.get(id);

      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Setup gh CLI authentication
      fastify.log.info(`Running gh CLI setup for workspace ${id}`);

      return { success: true, workspaceId: id, script: 'gh-cli-setup' };
    }
  );

  // POST /api/task-attempts/:id/start-dev-server - Start dev server
  fastify.post<{ Params: { id: string }; Body: { command?: string; port?: number } }>(
    '/task-attempts/:id/start-dev-server',
    async (request, reply) => {
      const { id } = request.params;
      const { command, port } = request.body;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Start dev server process
      fastify.log.info(`Starting dev server for workspace ${id}: ${command}`);

      return {
        success: true,
        workspaceId: id,
        port: port ?? 3000,
        url: `http://localhost:${port ?? 3000}`
      };
    }
  );

  // POST /api/task-attempts/:id/run-setup-script
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/run-setup-script',
    async (request, reply) => {
      const { id } = request.params;
      const workspace = workspaces.get(id);

      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      fastify.log.info(`Running setup script for workspace ${id}`);
      return { success: true, workspaceId: id, script: 'setup' };
    }
  );

  // POST /api/task-attempts/:id/run-cleanup-script
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/run-cleanup-script',
    async (request, reply) => {
      const { id } = request.params;
      const workspace = workspaces.get(id);

      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      fastify.log.info(`Running cleanup script for workspace ${id}`);
      return { success: true, workspaceId: id, script: 'cleanup' };
    }
  );

  // POST /api/task-attempts/:id/run-archive-script
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/run-archive-script',
    async (request, reply) => {
      const { id } = request.params;
      const workspace = workspaces.get(id);

      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      fastify.log.info(`Running archive script for workspace ${id}`);
      return { success: true, workspaceId: id, script: 'archive' };
    }
  );

  // ==================== GIT OPERATIONS ====================

  // GET /api/task-attempts/:id/branch-status - Get branch status
  fastify.get<{ Params: { id: string } }>(
    '/task-attempts/:id/branch-status',
    async (request, reply) => {
      const { id } = request.params;
      const workspace = workspaces.get(id);

      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const status = getBranchStatus(workspace);

      return { workspaceId: id, branchStatus: [status] };
    }
  );

  // GET /api/task-attempts/:id/diff/ws - WebSocket for diff streaming
  fastify.get<{ Params: { id: string } }>(
    '/task-attempts/:id/diff/ws',
    { websocket: true } as any,
    async (socket: any, request) => {
      const { id } = request.params;

      if (!workspaces.has(id)) {
        socket.close(4004, 'Workspace not found');
        return;
      }

      if (!diffSubscribers.has(id)) {
        diffSubscribers.set(id, new Set());
      }
      diffSubscribers.get(id)!.add(socket);

      fastify.log.info(`Diff WebSocket connected for workspace ${id}`);

      // Send current diff
      const diff = workspaceDiffs.get(id) ?? [];
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
      const { id } = request.params;
      const { strategy = 'merge', message, deleteBranch = false } = request.body;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Perform actual merge
      fastify.log.info(`Merging workspace ${id} with strategy ${strategy}`);

      workspace.status = 'completed';
      workspace.updatedAt = new Date().toISOString();
      workspaces.set(id, workspace);

      return {
        success: true,
        workspaceId: id,
        strategy,
        merged: true,
        deletedBranch: deleteBranch
      };
    }
  );

  // POST /api/task-attempts/:id/push - Push branch
  fastify.post<{ Params: { id: string }; Body: { remote?: string } }>(
    '/task-attempts/:id/push',
    async (request, reply) => {
      const { id } = request.params;
      const { remote = 'origin' } = request.body;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Perform actual push
      fastify.log.info(`Pushing workspace ${id} to ${remote}`);

      return {
        success: true,
        workspaceId: id,
        remote,
        branch: workspace.branch
      };
    }
  );

  // POST /api/task-attempts/:id/push/force - Force push
  fastify.post<{ Params: { id: string }; Body: { remote?: string } }>(
    '/task-attempts/:id/push/force',
    async (request, reply) => {
      const { id } = request.params;
      const { remote = 'origin' } = request.body;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Perform force push
      fastify.log.info(`Force pushing workspace ${id} to ${remote}`);

      return {
        success: true,
        workspaceId: id,
        remote,
        branch: workspace.branch,
        forced: true
      };
    }
  );

  // POST /api/task-attempts/:id/rebase - Rebase branch
  fastify.post<{ Params: { id: string }; Body: RebaseBody }>(
    '/task-attempts/:id/rebase',
    async (request, reply) => {
      const { id } = request.params;
      const { targetBranch } = request.body;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const target = targetBranch ?? workspace.baseBranch;

      // TODO: Perform actual rebase
      fastify.log.info(`Rebasing workspace ${id} onto ${target}`);

      return {
        success: true,
        workspaceId: id,
        targetBranch: target,
        hasConflicts: false
      };
    }
  );

  // POST /api/task-attempts/:id/rebase/continue - Continue rebase
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/rebase/continue',
    async (request, reply) => {
      const { id } = request.params;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Continue rebase
      fastify.log.info(`Continuing rebase for workspace ${id}`);

      return { success: true, workspaceId: id, completed: true };
    }
  );

  // POST /api/task-attempts/:id/conflicts/abort - Abort conflicts
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/conflicts/abort',
    async (request, reply) => {
      const { id } = request.params;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Abort merge/rebase
      fastify.log.info(`Aborting conflicts for workspace ${id}`);

      return { success: true, workspaceId: id };
    }
  );

  // ==================== PR OPERATIONS ====================

  // POST /api/task-attempts/:id/pr - Create PR
  fastify.post<{ Params: { id: string }; Body: CreatePRBody }>(
    '/task-attempts/:id/pr',
    async (request, reply) => {
      const { id } = request.params;
      const { title, body, draft = false, remote = 'origin' } = request.body;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Create actual PR via gh CLI
      const prNumber = Math.floor(Math.random() * 10000);
      const prUrl = `https://github.com/owner/repo/pull/${prNumber}`;

      workspace.prNumber = prNumber;
      workspace.prUrl = prUrl;
      workspace.prState = 'open';
      workspace.updatedAt = new Date().toISOString();
      workspaces.set(id, workspace);

      emitEvent('pr.created', { workspaceId: id, prNumber, prUrl });

      fastify.log.info(`PR created for workspace ${id}: #${prNumber}`);

      return {
        success: true,
        workspaceId: id,
        prNumber,
        prUrl,
        draft
      };
    }
  );

  // POST /api/task-attempts/:id/pr/attach - Attach existing PR
  fastify.post<{ Params: { id: string }; Body: { prNumber: number; prUrl?: string } }>(
    '/task-attempts/:id/pr/attach',
    async (request, reply) => {
      const { id } = request.params;
      const { prNumber, prUrl } = request.body;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      workspace.prNumber = prNumber;
      workspace.prUrl = prUrl;
      workspace.prState = 'open';
      workspace.updatedAt = new Date().toISOString();
      workspaces.set(id, workspace);

      return { success: true, workspaceId: id, prNumber };
    }
  );

  // GET /api/task-attempts/:id/pr/comments - Get PR comments
  fastify.get<{ Params: { id: string } }>(
    '/task-attempts/:id/pr/comments',
    async (request, reply) => {
      const { id } = request.params;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      if (!workspace.prNumber) {
        return reply.status(400).send({ error: 'No PR attached to workspace' });
      }

      // TODO: Fetch actual PR comments via gh CLI
      return {
        workspaceId: id,
        prNumber: workspace.prNumber,
        comments: [],
        total: 0
      };
    }
  );

  // ==================== EDITOR & MISC ====================

  // POST /api/task-attempts/:id/open-editor - Open in editor
  fastify.post<{ Params: { id: string }; Body: { editor?: string; file?: string } }>(
    '/task-attempts/:id/open-editor',
    async (request, reply) => {
      const { id } = request.params;
      const { editor = 'vscode', file } = request.body;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const targetPath = file
        ? path.join(workspace.worktreePath ?? workspace.repoPath, file)
        : workspace.worktreePath ?? workspace.repoPath;

      // TODO: Open editor
      fastify.log.info(`Opening ${targetPath} in ${editor}`);

      return { success: true, path: targetPath, editor };
    }
  );

  // GET /api/task-attempts/:id/children - Get child workspaces
  fastify.get<{ Params: { id: string } }>(
    '/task-attempts/:id/children',
    async (request, reply) => {
      const { id } = request.params;

      if (!workspaces.has(id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Track parent-child relationships
      return { workspaceId: id, children: [], total: 0 };
    }
  );

  // POST /api/task-attempts/:id/stop - Stop execution
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/stop',
    async (request, reply) => {
      const { id } = request.params;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      workspace.status = 'paused';
      workspace.updatedAt = new Date().toISOString();
      workspaces.set(id, workspace);

      fastify.log.info(`Workspace ${id} execution stopped`);

      return { success: true, workspaceId: id, status: 'paused' };
    }
  );

  // POST /api/task-attempts/:id/change-target-branch
  fastify.post<{ Params: { id: string }; Body: { targetBranch: string } }>(
    '/task-attempts/:id/change-target-branch',
    async (request, reply) => {
      const { id } = request.params;
      const { targetBranch } = request.body;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      workspace.baseBranch = targetBranch;
      workspace.updatedAt = new Date().toISOString();
      workspaces.set(id, workspace);

      return { success: true, workspaceId: id, baseBranch: targetBranch };
    }
  );

  // POST /api/task-attempts/:id/rename-branch
  fastify.post<{ Params: { id: string }; Body: { newName: string } }>(
    '/task-attempts/:id/rename-branch',
    async (request, reply) => {
      const { id } = request.params;
      const { newName } = request.body;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      const oldBranch = workspace.branch;
      workspace.branch = newName;
      workspace.updatedAt = new Date().toISOString();
      workspaces.set(id, workspace);

      // TODO: Rename actual git branch

      return {
        success: true,
        workspaceId: id,
        oldBranch,
        newBranch: newName
      };
    }
  );

  // GET /api/task-attempts/:id/repos - Get workspace repos
  fastify.get<{ Params: { id: string } }>(
    '/task-attempts/:id/repos',
    async (request, reply) => {
      const { id } = request.params;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      return {
        workspaceId: id,
        repos: [{
          id: workspace.repoId,
          path: workspace.repoPath,
          branch: workspace.branch
        }]
      };
    }
  );

  // GET /api/task-attempts/:id/first-message
  fastify.get<{ Params: { id: string } }>(
    '/task-attempts/:id/first-message',
    async (request, reply) => {
      const { id } = request.params;

      if (!workspaces.has(id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Get from session store
      return { workspaceId: id, message: null };
    }
  );

  // PUT /api/task-attempts/:id/mark-seen
  fastify.put<{ Params: { id: string }; Body: { turnIds: string[] } }>(
    '/task-attempts/:id/mark-seen',
    async (request, reply) => {
      const { id } = request.params;
      const { turnIds } = request.body;

      if (!workspaces.has(id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Mark agent turns as seen
      return { success: true, workspaceId: id, markedSeen: turnIds.length };
    }
  );

  // ==================== REMOTE LINKING ====================

  // POST /api/task-attempts/:id/link - Link to remote
  fastify.post<{ Params: { id: string }; Body: { remoteWorkspaceId: string } }>(
    '/task-attempts/:id/link',
    async (request, reply) => {
      const { id } = request.params;
      const { remoteWorkspaceId } = request.body;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      workspace.remoteWorkspaceId = remoteWorkspaceId;
      workspace.updatedAt = new Date().toISOString();
      workspaces.set(id, workspace);

      return { success: true, workspaceId: id, remoteWorkspaceId };
    }
  );

  // POST /api/task-attempts/:id/unlink - Unlink from remote
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/unlink',
    async (request, reply) => {
      const { id } = request.params;

      const workspace = workspaces.get(id);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      delete workspace.remoteWorkspaceId;
      workspace.updatedAt = new Date().toISOString();
      workspaces.set(id, workspace);

      return { success: true, workspaceId: id };
    }
  );

  // ==================== WORKSPACE IMAGES ====================

  // POST /api/task-attempts/:id/images/upload
  fastify.post<{ Params: { id: string } }>(
    '/task-attempts/:id/images/upload',
    async (request, reply) => {
      const { id } = request.params;

      if (!workspaces.has(id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Handle file upload
      const imageId = crypto.randomUUID();

      return {
        success: true,
        workspaceId: id,
        imageId,
        url: `/api/task-attempts/${id}/images/${imageId}/file`
      };
    }
  );

  // GET /api/task-attempts/:id/images/:imageId/file
  fastify.get<{ Params: { id: string; imageId: string } }>(
    '/task-attempts/:id/images/:imageId/file',
    async (request, reply) => {
      const { id, imageId } = request.params;

      if (!workspaces.has(id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Serve image file
      return reply.status(404).send({ error: 'Image not found' });
    }
  );

  // DELETE /api/task-attempts/:id/images/:imageId
  fastify.delete<{ Params: { id: string; imageId: string } }>(
    '/task-attempts/:id/images/:imageId',
    async (request, reply) => {
      const { id, imageId } = request.params;

      if (!workspaces.has(id)) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // TODO: Delete image
      return reply.status(204).send();
    }
  );
};

// Helper functions
function getBranchStatus(workspace: Workspace): BranchStatus {
  // TODO: Get actual git status
  return {
    repoId: workspace.repoId,
    branch: workspace.branch,
    baseBranch: workspace.baseBranch,
    ahead: 0,
    behind: 0,
    hasConflicts: false,
    isDirty: false
  };
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

// Export helpers
export function getWorkspace(id: string): Workspace | undefined {
  return workspaces.get(id);
}

export function updateWorkspaceDiff(workspaceId: string, files: DiffFile[]): void {
  workspaceDiffs.set(workspaceId, files);

  // Notify subscribers
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
