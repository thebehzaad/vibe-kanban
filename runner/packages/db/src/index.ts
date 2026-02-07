/**
 * @runner/db
 *
 * Database abstraction layer for runner.
 * TypeScript translation of crates/db.
 *
 * This package provides:
 * - SQLite/PostgreSQL database connections
 * - Model definitions for all entities
 * - Query builders and repositories
 */

// Models (to be implemented)
export * from './models/index.js';

// Database connection and pool
export * from './connection.js';
