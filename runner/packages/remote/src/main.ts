/**
 * Remote server entry point
 * Translates: crates/remote/src/main.rs
 */

import { createRemoteServer } from './app.js';

async function main() {
  // TODO: Load configuration
  const port = parseInt(process.env.PORT || '8081', 10);
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://remote:remote@localhost:5432/remote';
  const jwtSecret = process.env.VIBEKANBAN_REMOTE_JWT_SECRET;

  if (!jwtSecret) {
    console.error('VIBEKANBAN_REMOTE_JWT_SECRET environment variable is required');
    process.exit(1);
  }

  // TODO: Initialize server
  const server = await createRemoteServer({
    port,
    databaseUrl,
    jwtSecret
  });

  // TODO: Start server
  console.log(`Remote server starting on port ${port}...`);
}

main().catch(error => {
  console.error('Failed to start remote server:', error);
  process.exit(1);
});
