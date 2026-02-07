/**
 * CORS middleware
 * Translates: crates/remote/src/middleware/cors.rs
 */

export const corsConfig = {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
};
