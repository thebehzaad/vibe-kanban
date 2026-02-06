/**
 * Fastify app setup
 * Translates: crates/server/src/main.rs, crates/server/src/lib.rs
 *
 * In Rust, the server creates a DeploymentImpl and passes it as
 * Axum router state via `.with_state(deployment)`. Routes then
 * access it via `State(deployment): State<DeploymentImpl>`.
 *
 * In TypeScript, we mirror this by decorating Fastify with the
 * deployment instance, accessible as `fastify.deployment` in all routes.
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import type { Deployment } from '@orchestrator/deployment';

// Import all route plugins
import { healthRoutes } from './routes/health.js';
import { configRoutes } from './routes/config.js';
import { eventRoutes } from './routes/events.js';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';
import { sessionRoutes } from './routes/sessions.js';
import { repoRoutes } from './routes/repos.js';
import { organizationRoutes } from './routes/organizations.js';
import { tagRoutes } from './routes/tags.js';
import { taskAttemptRoutes } from './routes/task-attempts.js';
import { executionProcessRoutes } from './routes/execution-processes.js';
import { approvalRoutes } from './routes/approvals.js';
import { filesystemRoutes } from './routes/filesystem.js';
import { imageRoutes } from './routes/images.js';
import { scratchRoutes } from './routes/scratch.js';
import { searchRoutes } from './routes/search.js';
import { containerRoutes } from './routes/containers.js';
import { terminalRoutes } from './routes/terminal.js';
import { oauthRoutes } from './routes/oauth.js';

export interface ServerConfig {
  port: number;
  host?: string;
  logger?: boolean;
  imagesDir?: string;
  deployment: Deployment;
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

  // Register WebSocket support
  await app.register(websocket);

  // Register multipart/form-data support for file uploads
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB max file size
      files: 10 // Max 10 files per request
    }
  });

  // Decorate app with config values
  app.decorate('imagesDir', config.imagesDir ?? './images');

  // Decorate app with deployment (mirrors Rust's `.with_state(deployment)`)
  app.decorate('deployment', config.deployment);

  // ========================================
  // Core routes
  // ========================================

  // Health check
  await app.register(healthRoutes, { prefix: '/api' });

  // System configuration
  await app.register(configRoutes, { prefix: '/api' });

  // Server-Sent Events stream
  await app.register(eventRoutes, { prefix: '/api' });

  // ========================================
  // Entity CRUD routes
  // ========================================

  // Projects
  await app.register(projectRoutes, { prefix: '/api' });

  // Tasks
  await app.register(taskRoutes, { prefix: '/api' });

  // Sessions
  await app.register(sessionRoutes, { prefix: '/api' });

  // Repositories
  await app.register(repoRoutes, { prefix: '/api' });

  // Organizations
  await app.register(organizationRoutes, { prefix: '/api' });

  // Tags
  await app.register(tagRoutes, { prefix: '/api' });

  // ========================================
  // Workspace management routes
  // ========================================

  // Task attempts (workspaces, branches, merges, PRs)
  await app.register(taskAttemptRoutes, { prefix: '/api' });

  // ========================================
  // Execution & process routes
  // ========================================

  // Execution processes with log streaming
  await app.register(executionProcessRoutes, { prefix: '/api' });

  // Approval requests
  await app.register(approvalRoutes, { prefix: '/api' });

  // ========================================
  // File & content routes
  // ========================================

  // Filesystem operations
  await app.register(filesystemRoutes, { prefix: '/api' });

  // Image upload/serve
  await app.register(imageRoutes, { prefix: '/api' });

  // Scratch pad storage
  await app.register(scratchRoutes, { prefix: '/api' });

  // Multi-repo search
  await app.register(searchRoutes, { prefix: '/api' });

  // ========================================
  // Infrastructure routes
  // ========================================

  // Container management
  await app.register(containerRoutes, { prefix: '/api' });

  // Terminal WebSocket
  await app.register(terminalRoutes, { prefix: '/api' });

  // OAuth authentication
  await app.register(oauthRoutes, { prefix: '/api' });

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

// Type augmentation for Fastify
// Mirrors Rust's `State(deployment): State<DeploymentImpl>`
declare module 'fastify' {
  interface FastifyInstance {
    imagesDir: string;
    deployment: Deployment;
  }
}
