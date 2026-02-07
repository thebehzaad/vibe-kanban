/**
 * Auth middleware
 * Translates: crates/remote/src/auth/middleware.rs
 */

export interface AuthContext {
  userId: string;
  organizationId?: string;
}

// TODO: Implement auth middleware for Express/Fastify
export function authMiddleware() {
  // Placeholder
}
