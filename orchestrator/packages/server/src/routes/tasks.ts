/**
 * Tasks routes
 * Translates: crates/server/src/routes/tasks.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';

// Task types
export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskBody {
  title: string;
  description?: string;
  projectId?: string;
}

export interface UpdateTaskBody {
  title?: string;
  description?: string;
  status?: Task['status'];
}

// In-memory store (replace with database)
const tasks = new Map<string, Task>();

export const taskRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/tasks - List all tasks
  fastify.get('/tasks', async (_request, _reply) => {
    return {
      tasks: Array.from(tasks.values()),
      total: tasks.size
    };
  });

  // GET /api/tasks/:id - Get task by ID
  fastify.get<{ Params: { id: string } }>('/tasks/:id', async (request, reply) => {
    const { id } = request.params;
    const task = tasks.get(id);

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    return task;
  });

  // POST /api/tasks - Create new task
  fastify.post<{ Body: CreateTaskBody }>('/tasks', async (request, reply) => {
    const { title, description, projectId } = request.body;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const task: Task = {
      id,
      title,
      description,
      projectId,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    };

    tasks.set(id, task);

    return reply.status(201).send(task);
  });

  // PATCH /api/tasks/:id - Update task
  fastify.patch<{ Params: { id: string }; Body: UpdateTaskBody }>(
    '/tasks/:id',
    async (request, reply) => {
      const { id } = request.params;
      const updates = request.body;

      const task = tasks.get(id);
      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      const updatedTask: Task = {
        ...task,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      tasks.set(id, updatedTask);

      return updatedTask;
    }
  );

  // DELETE /api/tasks/:id - Delete task
  fastify.delete<{ Params: { id: string } }>('/tasks/:id', async (request, reply) => {
    const { id } = request.params;

    if (!tasks.has(id)) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    tasks.delete(id);

    return reply.status(204).send();
  });

  // POST /api/tasks/:id/execute - Execute task with an executor
  fastify.post<{ Params: { id: string }; Body: { executorType: string } }>(
    '/tasks/:id/execute',
    async (request, reply) => {
      const { id } = request.params;
      const { executorType } = request.body;

      const task = tasks.get(id);
      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      // Update task status
      task.status = 'in_progress';
      task.updatedAt = new Date().toISOString();
      tasks.set(id, task);

      // TODO: Actually execute with the specified executor
      fastify.log.info(`Executing task ${id} with executor: ${executorType}`);

      return {
        taskId: id,
        executorType,
        status: 'started',
        message: `Task execution started with ${executorType}`
      };
    }
  );
};
