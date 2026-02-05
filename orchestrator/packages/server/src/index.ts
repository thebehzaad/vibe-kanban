/**
 * @orchestrator/server
 *
 * HTTP API server for orchestrator.
 * TypeScript translation of crates/server.
 *
 * Implemented routes:
 * - /api/health - Health checks
 * - /api/projects - Project CRUD
 * - /api/tasks - Task CRUD + execution
 * - /api/sessions - Session management
 *
 * TODO routes:
 * - /api/execution-processes
 * - /api/config
 * - /api/filesystem
 * - /api/images
 * - /api/approvals
 * - /api/events (WebSocket)
 */

export * from './app.js';
export * from './routes/index.js';

// Re-export route types
export type { HealthResponse } from './routes/health.js';
export type { Task, CreateTaskBody, UpdateTaskBody } from './routes/tasks.js';
export type { Project, CreateProjectBody, UpdateProjectBody } from './routes/projects.js';
export type {
  Session,
  SessionMessage,
  CreateSessionBody,
  QueueMessageBody
} from './routes/sessions.js';
