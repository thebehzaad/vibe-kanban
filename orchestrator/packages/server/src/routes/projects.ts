/**
 * Projects routes
 * Translates: crates/server/src/routes/projects.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';

// Project types
export interface Project {
  id: string;
  name: string;
  description?: string;
  repoPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectBody {
  name: string;
  description?: string;
  repoPath?: string;
}

export interface UpdateProjectBody {
  name?: string;
  description?: string;
  repoPath?: string;
}

// In-memory store (replace with database)
const projects = new Map<string, Project>();

export const projectRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/projects - List all projects
  fastify.get('/projects', async () => {
    return {
      projects: Array.from(projects.values()),
      total: projects.size
    };
  });

  // GET /api/projects/:id - Get project by ID
  fastify.get<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const { id } = request.params;
    const project = projects.get(id);

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    return project;
  });

  // POST /api/projects - Create new project
  fastify.post<{ Body: CreateProjectBody }>('/projects', async (request, reply) => {
    const { name, description, repoPath } = request.body;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const project: Project = {
      id,
      name,
      description,
      repoPath,
      createdAt: now,
      updatedAt: now
    };

    projects.set(id, project);

    return reply.status(201).send(project);
  });

  // PATCH /api/projects/:id - Update project
  fastify.patch<{ Params: { id: string }; Body: UpdateProjectBody }>(
    '/projects/:id',
    async (request, reply) => {
      const { id } = request.params;
      const updates = request.body;

      const project = projects.get(id);
      if (!project) {
        return reply.status(404).send({ error: 'Project not found' });
      }

      const updatedProject: Project = {
        ...project,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      projects.set(id, updatedProject);

      return updatedProject;
    }
  );

  // DELETE /api/projects/:id - Delete project
  fastify.delete<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const { id } = request.params;

    if (!projects.has(id)) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    projects.delete(id);

    return reply.status(204).send();
  });

  // GET /api/projects/:id/tasks - Get tasks for project
  fastify.get<{ Params: { id: string } }>('/projects/:id/tasks', async (request, reply) => {
    const { id } = request.params;

    if (!projects.has(id)) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // TODO: Query tasks from database filtered by projectId
    return {
      projectId: id,
      tasks: [],
      total: 0
    };
  });
};
