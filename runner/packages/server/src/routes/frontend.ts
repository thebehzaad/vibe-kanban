/**
 * Frontend serving routes
 * Translates: crates/server/src/routes/frontend.rs
 *
 * Serves the frontend static files and handles SPA routing.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const frontendRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // TODO: Implement frontend static file serving
  // In Rust, this uses rust-embed to serve built frontend assets
  
  fastify.get('/', async (_request, reply) => {
    // TODO: Serve index.html
    return reply.status(501).send({ error: 'Frontend serving not implemented' });
  });

  fastify.get('/*', async (_request, reply) => {
    // TODO: Serve SPA routes (always return index.html for client-side routing)
    return reply.status(501).send({ error: 'Frontend serving not implemented' });
  });
};
