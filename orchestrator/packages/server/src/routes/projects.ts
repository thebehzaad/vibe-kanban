/**
 * Projects routes
 * Translates: crates/server/src/routes/projects.rs
 */

// TODO: Implement project CRUD routes
export const projectRoutes = {
  list: '/api/projects',
  get: '/api/projects/:id',
  create: '/api/projects',
  update: '/api/projects/:id',
  delete: '/api/projects/:id'
};
