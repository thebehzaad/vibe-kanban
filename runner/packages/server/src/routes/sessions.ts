/**
 * Sessions routes
 * Translates: crates/server/src/routes/sessions/
 *
 * Rust pattern: State(deployment) → deployment.db().pool → Session::find_by_id(&pool, id)
 * TS pattern:   fastify.deployment → deployment.db() → new SessionRepository(db).findById(id)
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { SessionRepository } from '@runner/db';

// Re-export DB types for consumers
export type { Session } from '@runner/db';

export interface CreateSessionBody {
  workspaceId: string;
  executor?: string;
}

export interface QueueMessageBody {
  content: string;
}

export const sessionRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const db = () => fastify.deployment.db();
  const getRepo = () => new SessionRepository(db());

  // GET /api/sessions - List all sessions
  fastify.get<{ Querystring: { workspaceId?: string } }>('/sessions', async (request) => {
    const repo = getRepo();
    const { workspaceId } = request.query;

    if (workspaceId) {
      const sessions = repo.findByWorkspaceId(workspaceId);
      return { sessions, total: sessions.length };
    }

    // No list-all in the repo, return empty for now
    return { sessions: [], total: 0 };
  });

  // GET /api/sessions/:id - Get session by ID
  fastify.get<{ Params: { id: string } }>('/sessions/:id', async (request, reply) => {
    const repo = getRepo();
    const session = repo.findById(request.params.id);

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return session;
  });

  // POST /api/sessions - Create new session
  fastify.post<{ Body: CreateSessionBody }>('/sessions', async (request, reply) => {
    const repo = getRepo();
    const { workspaceId, executor } = request.body;

    const session = repo.create({ workspaceId });

    if (executor) {
      repo.updateExecutor(session.id, executor);
    }

    return reply.status(201).send(repo.findById(session.id) ?? session);
  });

  // DELETE /api/sessions/:id - End/delete session
  fastify.delete<{ Params: { id: string } }>('/sessions/:id', async (request, reply) => {
    const repo = getRepo();
    const changes = repo.delete(request.params.id);

    if (changes === 0) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return reply.status(204).send();
  });

  // POST /api/sessions/:id/queue - Queue a message to the session
  fastify.post<{ Params: { id: string }; Body: QueueMessageBody }>(
    '/sessions/:id/queue',
    async (request, reply) => {
      const repo = getRepo();
      const { id } = request.params;
      const { content } = request.body;

      const session = repo.findById(id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      fastify.log.info(`Queued message to session ${id}: ${content.substring(0, 50)}...`);

      return {
        sessionId: id,
        messageId: crypto.randomUUID(),
        status: 'queued',
      };
    }
  );

  // GET /api/sessions/:id/messages - Get session messages
  fastify.get<{ Params: { id: string } }>('/sessions/:id/messages', async (request, reply) => {
    const repo = getRepo();
    const session = repo.findById(request.params.id);

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    return {
      sessionId: request.params.id,
      messages: [],
      total: 0,
    };
  });

  // GET /api/sessions/workspace/:workspaceId/latest - Get latest session for workspace
  fastify.get<{ Params: { workspaceId: string } }>(
    '/sessions/workspace/:workspaceId/latest',
    async (request, reply) => {
      const repo = getRepo();
      const session = repo.findLatestByWorkspaceId(request.params.workspaceId);

      if (!session) {
        return reply.status(404).send({ error: 'No sessions found for workspace' });
      }
      return session;
    }
  );
};
