/**
 * Health check routes
 * Translates: crates/server/src/routes/health.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: string;
}

const startTime = Date.now();

export const healthRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/health
  fastify.get('/health', async (_request, _reply) => {
    const response: HealthResponse = {
      status: 'ok',
      version: process.env['npm_package_version'] ?? '0.0.1',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString()
    };
    return response;
  });

  // GET /api/health/ready - Kubernetes readiness probe
  fastify.get('/health/ready', async (_request, reply) => {
    // TODO: Check database connection, external services
    return reply.status(200).send({ ready: true });
  });

  // GET /api/health/live - Kubernetes liveness probe
  fastify.get('/health/live', async (_request, reply) => {
    return reply.status(200).send({ alive: true });
  });
};
