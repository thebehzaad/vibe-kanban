/**
 * Express/Fastify app setup
 * Translates: crates/server/src/main.rs, crates/server/src/lib.rs
 */

export interface ServerConfig {
  port: number;
  host?: string;
}

export async function createApp(config: ServerConfig) {
  // TODO: Implement with Express, Fastify, or Hono
  // - Setup middleware
  // - Register routes
  // - Setup WebSocket for events
  throw new Error('Not implemented');
}

export async function startServer(config: ServerConfig) {
  const app = await createApp(config);
  // TODO: Start listening
  console.log(`Server starting on ${config.host ?? '0.0.0.0'}:${config.port}`);
}
