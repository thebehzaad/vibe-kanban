/**
 * OAuth / Authentication routes
 * Translates: crates/server/src/routes/oauth.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as crypto from 'node:crypto';

// Types
export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  createdAt: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  createdAt: string;
}

export interface LoginStatus {
  loggedIn: boolean;
  user?: AuthUser;
  expiresAt?: string;
}

export interface HandoffInitResponse {
  handoffId: string;
  authorizeUrl: string;
  expiresAt: string;
}

export interface HandoffCompleteParams {
  handoff_id: string;
  app_code?: string;
  error?: string;
}

// Configuration
const AUTH_SERVER_URL = process.env['AUTH_SERVER_URL'] ?? 'https://auth.example.com';
const CLIENT_ID = process.env['OAUTH_CLIENT_ID'] ?? 'runner';
const REDIRECT_URI = process.env['OAUTH_REDIRECT_URI'] ?? 'http://localhost:3000/api/auth/handoff/complete';

// In-memory stores
const users = new Map<string, AuthUser>();
const sessions = new Map<string, AuthSession>();
const pendingHandoffs = new Map<string, { createdAt: Date; expiresAt: Date }>();

// Current session (simplified - in real app would use cookies/JWT)
let currentSession: AuthSession | null = null;

export const oauthRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // POST /api/auth/handoff/init - Initialize OAuth handoff
  fastify.post('/auth/handoff/init', async () => {
    const handoffId = crypto.randomUUID();
    const state = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    pendingHandoffs.set(handoffId, {
      createdAt: new Date(),
      expiresAt
    });

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      state: `${handoffId}:${state}`,
      scope: 'openid profile email'
    });

    const authorizeUrl = `${AUTH_SERVER_URL}/authorize?${params}`;

    const response: HandoffInitResponse = {
      handoffId,
      authorizeUrl,
      expiresAt: expiresAt.toISOString()
    };

    fastify.log.info(`OAuth handoff initiated: ${handoffId}`);

    return response;
  });

  // GET /api/auth/handoff/complete - OAuth callback
  fastify.get<{ Querystring: HandoffCompleteParams }>(
    '/auth/handoff/complete',
    async (request, reply) => {
      const { handoff_id, app_code, error } = request.query;

      if (error) {
        fastify.log.error(`OAuth error: ${error}`);
        // Redirect to frontend with error
        return reply.redirect(`/?auth_error=${encodeURIComponent(error)}`);
      }

      if (!handoff_id || !app_code) {
        return reply.redirect('/?auth_error=missing_params');
      }

      const handoff = pendingHandoffs.get(handoff_id);
      if (!handoff) {
        return reply.redirect('/?auth_error=invalid_handoff');
      }

      if (new Date() > handoff.expiresAt) {
        pendingHandoffs.delete(handoff_id);
        return reply.redirect('/?auth_error=handoff_expired');
      }

      pendingHandoffs.delete(handoff_id);

      // Exchange code for tokens (mock implementation)
      // In real implementation, call auth server's token endpoint
      const userId = crypto.randomUUID();
      const user: AuthUser = {
        id: userId,
        email: `user-${userId.slice(0, 8)}@example.com`,
        name: 'Demo User',
        createdAt: new Date().toISOString()
      };
      users.set(userId, user);

      const session: AuthSession = {
        id: crypto.randomUUID(),
        userId,
        accessToken: crypto.randomBytes(32).toString('hex'),
        refreshToken: crypto.randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
        createdAt: new Date().toISOString()
      };
      sessions.set(session.id, session);
      currentSession = session;

      fastify.log.info(`OAuth completed for user: ${userId}`);

      // Redirect to frontend
      return reply.redirect('/?auth_success=true');
    }
  );

  // POST /api/auth/logout - Logout
  fastify.post('/auth/logout', async () => {
    if (currentSession) {
      sessions.delete(currentSession.id);
      currentSession = null;
    }

    return { success: true };
  });

  // GET /api/auth/status - Get login status
  fastify.get('/auth/status', async () => {
    if (!currentSession) {
      return { loggedIn: false };
    }

    // Check if session is expired
    if (new Date(currentSession.expiresAt) < new Date()) {
      sessions.delete(currentSession.id);
      currentSession = null;
      return { loggedIn: false };
    }

    const user = users.get(currentSession.userId);

    const status: LoginStatus = {
      loggedIn: true,
      user,
      expiresAt: currentSession.expiresAt
    };

    return status;
  });

  // GET /api/auth/token - Get access token (with auto-refresh)
  fastify.get('/auth/token', async (request, reply) => {
    if (!currentSession) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }

    // Check if token needs refresh
    const expiresAt = new Date(currentSession.expiresAt);
    const now = new Date();
    const fiveMinutes = 5 * 60 * 1000;

    if (expiresAt.getTime() - now.getTime() < fiveMinutes) {
      // Refresh the token
      if (currentSession.refreshToken) {
        // Mock token refresh - in real implementation, call auth server
        currentSession.accessToken = crypto.randomBytes(32).toString('hex');
        currentSession.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        sessions.set(currentSession.id, currentSession);
        fastify.log.info(`Token refreshed for session: ${currentSession.id}`);
      } else {
        // No refresh token, session will expire
        fastify.log.warn(`Session ${currentSession.id} expiring soon, no refresh token`);
      }
    }

    return {
      accessToken: currentSession.accessToken,
      expiresAt: currentSession.expiresAt
    };
  });

  // GET /api/auth/user - Get current user ID
  fastify.get('/auth/user', async (request, reply) => {
    if (!currentSession) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }

    return { userId: currentSession.userId };
  });

  // POST /api/auth/dev-login - Development-only login (skip OAuth)
  if (process.env['NODE_ENV'] !== 'production') {
    fastify.post<{ Body: { email: string; name?: string } }>(
      '/auth/dev-login',
      async (request) => {
        const { email, name } = request.body;

        const userId = crypto.randomUUID();
        const user: AuthUser = {
          id: userId,
          email,
          name: name ?? email.split('@')[0],
          createdAt: new Date().toISOString()
        };
        users.set(userId, user);

        const session: AuthSession = {
          id: crypto.randomUUID(),
          userId,
          accessToken: crypto.randomBytes(32).toString('hex'),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          createdAt: new Date().toISOString()
        };
        sessions.set(session.id, session);
        currentSession = session;

        fastify.log.info(`Dev login for user: ${email}`);

        return {
          success: true,
          user,
          accessToken: session.accessToken,
          expiresAt: session.expiresAt
        };
      }
    );
  }
};

// Helper functions for authentication middleware
export function getCurrentUser(): AuthUser | null {
  if (!currentSession) return null;
  return users.get(currentSession.userId) ?? null;
}

export function getCurrentUserId(): string | null {
  return currentSession?.userId ?? null;
}

export function isAuthenticated(): boolean {
  if (!currentSession) return false;
  return new Date(currentSession.expiresAt) > new Date();
}

export function requireAuth(request: any, reply: any, done: () => void): void {
  if (!isAuthenticated()) {
    reply.status(401).send({ error: 'Authentication required' });
    return;
  }
  done();
}
