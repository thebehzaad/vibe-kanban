/**
 * Rate limiting middleware
 * Translates: crates/remote/src/middleware/rate_limit.rs
 */

import { FastifyRequest, FastifyReply } from 'fastify';

export async function rateLimitMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // TODO: Implement rate limiting
  throw new Error('Not implemented');
}

export const rateLimitConfig = {
  max: 100,
  timeWindow: '1 minute'
};
