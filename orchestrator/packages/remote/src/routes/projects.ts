/**
 * Project routes
 * Translates: crates/remote/src/routes/projects.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const projectRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/projects
  fastify.get('/projects', async (request, reply) => {
    // TODO: List projects
    return reply.status(501).send({ error: 'Not implemented' });
  });

  // POST /api/projects
  fastify.post('/projects', async (request, reply) => {
    // TODO: Create project
    return reply.status(501).send({ error: 'Not implemented' });
  });

  // GET /api/projects/:id
  fastify.get('/projects/:id', async (request, reply) => {
    // TODO: Get project
    return reply.status(501).send({ error: 'Not implemented' });
  });

  // PATCH /api/projects/:id
  fastify.patch('/projects/:id', async (request, reply) => {
    // TODO: Update project
    return reply.status(501).send({ error: 'Not implemented' });
  });

  // DELETE /api/projects/:id
  fastify.delete('/projects/:id', async (request, reply) => {
    // TODO: Delete project
    return reply.status(501).send({ error: 'Not implemented' });
  });
};
