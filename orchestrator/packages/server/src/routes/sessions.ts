/**
 * Sessions routes
 * Translates: crates/server/src/routes/sessions/
 */

// TODO: Implement session management routes
export const sessionRoutes = {
  list: '/api/sessions',
  get: '/api/sessions/:id',
  create: '/api/sessions',
  delete: '/api/sessions/:id',
  queue: '/api/sessions/:id/queue'
};
