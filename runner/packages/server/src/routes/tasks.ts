/**
 * Tasks routes
 * Translates: crates/server/src/routes/tasks.rs
 *
 * Rust pattern: State(deployment) → deployment.db().pool → Task::find_all(&pool)
 * TS pattern:   fastify.deployment → deployment.db() → new TaskRepository(db).findAll()
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { TaskRepository, type TaskStatus } from '@runner/db';

// Re-export DB types for consumers
export type { Task } from '@runner/db';

export interface CreateTaskBody {
  title: string;
  description?: string;
  projectId: string;
  status?: TaskStatus;
  parentWorkspaceId?: string;
  imageIds?: string[];
}

export interface UpdateTaskBody {
  title?: string;
  description?: string;
  status?: TaskStatus;
}

export const taskRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const db = () => fastify.deployment.db();
  const getRepo = () => new TaskRepository(db());

  // GET /api/tasks - List all tasks
  fastify.get<{ Querystring: { projectId?: string } }>('/tasks', async (request) => {
    const repo = getRepo();
    const { projectId } = request.query;

    if (projectId) {
      const tasks = repo.findByProjectIdWithAttemptStatus(projectId);
      return { tasks, total: tasks.length };
    }

    const tasks = repo.findAll();
    return { tasks, total: tasks.length };
  });

  // GET /api/tasks/:id - Get task by ID
  fastify.get<{ Params: { id: string } }>('/tasks/:id', async (request, reply) => {
    const repo = getRepo();
    const task = repo.findById(request.params.id);

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    return task;
  });

  // POST /api/tasks - Create new task
  fastify.post<{ Body: CreateTaskBody }>('/tasks', async (request, reply) => {
    const repo = getRepo();
    const { title, description, projectId, status, parentWorkspaceId, imageIds } = request.body;

    const task = repo.create({
      projectId,
      title,
      description,
      status,
      parentWorkspaceId,
      imageIds,
    });

    return reply.status(201).send(task);
  });

  // PATCH /api/tasks/:id - Update task
  fastify.patch<{ Params: { id: string }; Body: UpdateTaskBody }>(
    '/tasks/:id',
    async (request, reply) => {
      const repo = getRepo();
      const { id } = request.params;

      const task = repo.findById(id);
      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      const updated = repo.update(id, request.body);
      return updated;
    }
  );

  // DELETE /api/tasks/:id - Delete task
  fastify.delete<{ Params: { id: string } }>('/tasks/:id', async (request, reply) => {
    const repo = getRepo();
    const changes = repo.delete(request.params.id);

    if (changes === 0) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    return reply.status(204).send();
  });

  // POST /api/tasks/:id/execute - Execute task with an executor
  fastify.post<{ Params: { id: string }; Body: { executorType: string } }>(
    '/tasks/:id/execute',
    async (request, reply) => {
      const repo = getRepo();
      const { id } = request.params;
      const { executorType } = request.body;

      const task = repo.findById(id);
      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      repo.updateStatus(id, 'inprogress');
      fastify.log.info(`Executing task ${id} with executor: ${executorType}`);

      return {
        taskId: id,
        executorType,
        status: 'started',
        message: `Task execution started with ${executorType}`,
      };
    }
  );
};
