/**
 * Containers routes
 * Translates: crates/server/src/routes/containers.rs
 *
 * In local deployment, "containers" are git worktrees mapped via workspaces.
 * This route resolves container_ref strings to workspace/task/project info.
 *
 * Rust pattern: State(deployment) → deployment.container() / deployment.db()
 * TS pattern:   fastify.deployment → deployment.db() → new WorkspaceRepository(db)
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { WorkspaceRepository } from '@runner/db';

// Re-export DB types for consumers
export type { ContainerInfo } from '@runner/db';

export const containerRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const db = () => fastify.deployment.db();
  const getRepo = () => new WorkspaceRepository(db());

  // GET /api/containers/info - Get container info by reference
  fastify.get<{ Querystring: { ref: string } }>('/containers/info', async (request, reply) => {
    const { ref } = request.query;

    if (!ref) {
      return reply.status(400).send({ error: 'Container reference required' });
    }

    const repo = getRepo();
    const info = repo.resolveContainerRef(ref);

    if (!info) {
      return {
        ref,
        status: 'not_found',
      };
    }

    const workspace = repo.findByIdWithStatus(info.workspaceId);

    return {
      ref,
      workspaceId: info.workspaceId,
      taskId: info.taskId,
      projectId: info.projectId,
      status: workspace?.isRunning ? 'running' : 'stopped',
      archived: workspace?.archived ?? false,
      branch: workspace?.branch,
    };
  });

  // GET /api/containers/attempt-context - Get workspace context for container
  fastify.get<{ Querystring: { ref: string } }>(
    '/containers/attempt-context',
    async (request, reply) => {
      const { ref } = request.query;

      if (!ref) {
        return reply.status(400).send({ error: 'Container reference required' });
      }

      const repo = getRepo();
      const info = repo.resolveContainerRef(ref);

      if (!info) {
        return reply.status(404).send({ error: 'Workspace context not found' });
      }

      const workspace = repo.findById(info.workspaceId);
      if (!workspace) {
        return reply.status(404).send({ error: 'Workspace not found' });
      }

      // Get workspace repos from DB
      const workspaceRepos = db().prepare(`
        SELECT wr.repo_id, wr.target_branch, wr.worktree_path,
               r.path as repo_path, r.name as repo_name
        FROM workspace_repos wr
        JOIN repos r ON wr.repo_id = r.id
        WHERE wr.workspace_id = ?
      `).all(info.workspaceId) as Array<{
        repo_id: string;
        target_branch: string;
        worktree_path: string | null;
        repo_path: string;
        repo_name: string;
      }>;

      return {
        workspaceId: info.workspaceId,
        taskId: info.taskId,
        projectId: info.projectId,
        branch: workspace.branch,
        agentWorkingDir: workspace.agentWorkingDir,
        repos: workspaceRepos.map(wr => ({
          repoId: wr.repo_id,
          repoPath: wr.repo_path,
          repoName: wr.repo_name,
          targetBranch: wr.target_branch,
          worktreePath: wr.worktree_path ?? undefined,
        })),
      };
    }
  );
};
