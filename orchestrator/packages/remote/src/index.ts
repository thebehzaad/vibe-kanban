/**
 * @orchestrator/remote
 *
 * Remote cloud deployment server.
 * TypeScript translation of crates/remote.
 *
 * Standalone service for cloud-based deployment:
 * - PostgreSQL database
 * - Cloudflare R2 storage
 * - OAuth authentication
 * - GitHub App integration
 */

export * from './app.js';
export * from './config.js';
export * from './auth/index.js';
export * from './db/index.js';
