/**
 * Webhook routes
 * Translates: crates/remote/src/routes/webhooks.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const webhookRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // POST /api/webhooks/github
  fastify.post('/webhooks/github', async (request, reply) => {
    // TODO: Handle GitHub webhooks
    return reply.status(501).send({ error: 'Not implemented' });
  });
};
