/**
 * Tasks routes
 * Translates: crates/server/src/routes/tasks.rs
 */

// TODO: Implement task CRUD routes
export const taskRoutes = {
  list: '/api/tasks',
  get: '/api/tasks/:id',
  create: '/api/tasks',
  update: '/api/tasks/:id',
  delete: '/api/tasks/:id',
  execute: '/api/tasks/:id/execute'
};
