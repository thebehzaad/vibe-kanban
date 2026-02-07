/**
 * User routes
 * Translates: crates/remote/src/routes/users.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const userRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/users/me
  fastify.get('/users/me', async (request, reply) => {
    // TODO: Get current user
    return reply.status(501).send({ error: 'Not implemented' });
  });

  // PATCH /api/users/me
  fastify.patch('/users/me', async (request, reply) => {
    // TODO: Update current user
    return reply.status(501).send({ error: 'Not implemented' });
  });

  // DELETE /api/users/me
  fastify.delete('/users/me', async (request, reply) => {
    // TODO: Delete current user
    return reply.status(501).send({ error: 'Not implemented' });
  });
};
