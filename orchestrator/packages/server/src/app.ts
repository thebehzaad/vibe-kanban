/**
 * Fastify app setup
 * Translates: crates/server/src/main.rs, crates/server/src/lib.rs
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';
import { taskRoutes } from './routes/tasks.js';
import { projectRoutes } from './routes/projects.js';
import { sessionRoutes } from './routes/sessions.js';

export interface ServerConfig {
  port: number;
  host?: string;
  logger?: boolean;
}

export async function createApp(config: ServerConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logger ?? true
  });

  // Register CORS
  await app.register(cors, {
    origin: true,
    credentials: true
  });

  // Register routes
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(taskRoutes, { prefix: '/api' });
  await app.register(projectRoutes, { prefix: '/api' });
  await app.register(sessionRoutes, { prefix: '/api' });

  return app;
}

export async function startServer(config: ServerConfig): Promise<FastifyInstance> {
  const app = await createApp(config);

  try {
    const address = await app.listen({
      port: config.port,
      host: config.host ?? '0.0.0.0'
    });
    console.log(`Server listening on ${address}`);
    return app;
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
