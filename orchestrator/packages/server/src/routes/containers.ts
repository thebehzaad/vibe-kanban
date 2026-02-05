/**
 * Containers routes
 * Translates: crates/server/src/routes/containers.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';

// Types
export interface ContainerInfo {
  containerId: string;
  projectId: string;
  taskId?: string;
  attemptId?: string;
  status: 'running' | 'stopped' | 'creating' | 'error';
  createdAt: string;
}

export interface WorkspaceContext {
  workspaceId: string;
  projectId: string;
  taskId?: string;
  attemptId?: string;
  repoPath: string;
  branch: string;
  baseBranch: string;
  worktreePath?: string;
}

// Container reference format: project_id:task_id:attempt_id or just workspace_id
function parseContainerRef(ref: string): { projectId?: string; taskId?: string; attemptId?: string; workspaceId?: string } {
  const parts = ref.split(':');
  if (parts.length === 3) {
    return {
      projectId: parts[0],
      taskId: parts[1],
      attemptId: parts[2]
    };
  }
  return { workspaceId: ref };
}

// In-memory stores
const containers = new Map<string, ContainerInfo>();
const workspaceContexts = new Map<string, WorkspaceContext>();

export const containerRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/containers/info - Get container info by reference
  fastify.get<{ Querystring: { ref: string } }>('/containers/info', async (request, reply) => {
    const { ref } = request.query;

    if (!ref) {
      return reply.status(400).send({ error: 'Container reference required' });
    }

    const parsed = parseContainerRef(ref);

    // Look up container by workspace ID or composite key
    let container: ContainerInfo | undefined;

    if (parsed.workspaceId) {
      container = containers.get(parsed.workspaceId);
    } else if (parsed.projectId && parsed.taskId && parsed.attemptId) {
      const key = `${parsed.projectId}:${parsed.taskId}:${parsed.attemptId}`;
      container = containers.get(key);
    }

    if (!container) {
      // Return minimal info if container not found but reference is valid
      return {
        ref,
        ...parsed,
        status: 'not_found'
      };
    }

    return container;
  });

  // GET /api/containers/attempt-context - Get workspace context
  fastify.get<{ Querystring: { ref: string } }>(
    '/containers/attempt-context',
    async (request, reply) => {
      const { ref } = request.query;

      if (!ref) {
        return reply.status(400).send({ error: 'Container reference required' });
      }

      const parsed = parseContainerRef(ref);
      const workspaceId = parsed.workspaceId ?? `${parsed.projectId}:${parsed.taskId}:${parsed.attemptId}`;

      const context = workspaceContexts.get(workspaceId);

      if (!context) {
        return reply.status(404).send({ error: 'Workspace context not found' });
      }

      return context;
    }
  );
};

// Helper functions for managing containers
export function registerContainer(info: ContainerInfo): void {
  const key = info.attemptId
    ? `${info.projectId}:${info.taskId}:${info.attemptId}`
    : info.containerId;
  containers.set(key, info);
}

export function registerWorkspaceContext(context: WorkspaceContext): void {
  workspaceContexts.set(context.workspaceId, context);
}

export function getContainer(ref: string): ContainerInfo | undefined {
  return containers.get(ref);
}

export function getWorkspaceContext(workspaceId: string): WorkspaceContext | undefined {
  return workspaceContexts.get(workspaceId);
}
