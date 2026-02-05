/**
 * @orchestrator/server
 *
 * HTTP API server for orchestrator.
 * TypeScript translation of crates/server.
 *
 * Routes to implement:
 * - /api/health
 * - /api/projects
 * - /api/tasks
 * - /api/sessions
 * - /api/execution-processes
 * - /api/config
 * - /api/filesystem
 * - /api/images
 * - /api/approvals
 * - /api/events (WebSocket)
 */

export * from './app.js';
export * from './routes/index.js';
