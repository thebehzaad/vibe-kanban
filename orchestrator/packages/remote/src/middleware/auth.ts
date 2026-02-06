/**
 * Authentication middleware
 * Translates: crates/remote/src/middleware/auth.rs
 */

import { FastifyRequest, FastifyReply } from 'fastify';

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // TODO: Implement JWT authentication
  throw new Error('Not implemented');
}

export async function optionalAuthMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // TODO: Implement optional authentication
  throw new Error('Not implemented');
}
