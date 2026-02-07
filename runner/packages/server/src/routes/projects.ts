/**
 * Projects routes
 * Translates: crates/server/src/routes/projects.rs
 *
 * Rust pattern: State(deployment) → deployment.db().pool → Project::find_all(&pool)
 * TS pattern:   fastify.deployment → deployment.db() → new ProjectRepository(db).findAll()
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ProjectRepository, TaskRepository } from '@runner/db';

// Re-export DB types for consumers
export type { Project } from '@runner/db';

export interface CreateProjectBody {
  name: string;
  description?: string;
  repoPath?: string;
  defaultAgentWorkingDir?: string;
  remoteProjectId?: string;
}

export interface UpdateProjectBody {
  name?: string;
  description?: string;
  defaultAgentWorkingDir?: string;
  remoteProjectId?: string;
}

export const projectRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const db = () => fastify.deployment.db();
  const getRepo = () => new ProjectRepository(db());
  const getTaskRepo = () => new TaskRepository(db());

  // GET /api/projects - List all projects
  fastify.get('/projects', async () => {
    const repo = getRepo();
    const projects = repo.findAll();
    return { projects, total: projects.length };
  });

  // GET /api/projects/:id - Get project by ID
  fastify.get<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const repo = getRepo();
    const project = repo.findById(request.params.id);

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    return project;
  });

  // POST /api/projects - Create new project
  fastify.post<{ Body: CreateProjectBody }>('/projects', async (request, reply) => {
    const repo = getRepo();
    const { name, remoteProjectId } = request.body;

    const project = repo.create({ name });

    // Set optional fields after creation
    if (remoteProjectId) {
      repo.setRemoteProjectId(project.id, remoteProjectId);
    }

    return reply.status(201).send(repo.findById(project.id) ?? project);
  });

  // PATCH /api/projects/:id - Update project
  fastify.patch<{ Params: { id: string }; Body: UpdateProjectBody }>(
    '/projects/:id',
    async (request, reply) => {
      const repo = getRepo();
      const { id } = request.params;

      const project = repo.findById(id);
      if (!project) {
        return reply.status(404).send({ error: 'Project not found' });
      }

      const updated = repo.update(id, request.body);
      return updated;
    }
  );

  // DELETE /api/projects/:id - Delete project
  fastify.delete<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const repo = getRepo();
    const changes = repo.delete(request.params.id);

    if (changes === 0) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    return reply.status(204).send();
  });

  // GET /api/projects/:id/tasks - Get tasks for project
  fastify.get<{ Params: { id: string } }>('/projects/:id/tasks', async (request, reply) => {
    const projectRepo = getRepo();
    const { id } = request.params;

    if (!projectRepo.findById(id)) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const taskRepo = getTaskRepo();
    const tasks = taskRepo.findByProjectIdWithAttemptStatus(id);

    return { projectId: id, tasks, total: tasks.length };
  });

  // GET /api/projects/most-active - Get most active projects
  fastify.get<{ Querystring: { limit?: string } }>('/projects/most-active', async (request) => {
    const repo = getRepo();
    const limit = parseInt(request.query.limit ?? '10') || 10;
    const projects = repo.findMostActive(limit);
    return { projects, total: projects.length };
  });
};
