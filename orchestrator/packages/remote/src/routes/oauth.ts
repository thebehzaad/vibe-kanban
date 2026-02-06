/**
 * OAuth routes
 * Translates: crates/remote/src/routes/oauth.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const oauthRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/oauth/github
  fastify.get('/oauth/github', async (request, reply) => {
    // TODO: Redirect to GitHub OAuth
    return reply.status(501).send({ error: 'Not implemented' });
  });

  // GET /api/oauth/github/callback
  fastify.get('/oauth/github/callback', async (request, reply) => {
    // TODO: Handle GitHub OAuth callback
    return reply.status(501).send({ error: 'Not implemented' });
  });

  // GET /api/oauth/google
  fastify.get('/oauth/google', async (request, reply) => {
    // TODO: Redirect to Google OAuth
    return reply.status(501).send({ error: 'Not implemented' });
  });

  // GET /api/oauth/google/callback
  fastify.get('/oauth/google/callback', async (request, reply) => {
    // TODO: Handle Google OAuth callback
    return reply.status(501).send({ error: 'Not implemented' });
  });
};
