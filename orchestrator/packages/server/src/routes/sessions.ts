/**
 * Sessions routes
 * Translates: crates/server/src/routes/sessions/
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';

// Session types
export interface Session {
  id: string;
  taskId?: string;
  executorType: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  messages: SessionMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface CreateSessionBody {
  taskId?: string;
  executorType: string;
}

export interface QueueMessageBody {
  content: string;
}

// In-memory store (replace with database)
const sessions = new Map<string, Session>();

export const sessionRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/sessions - List all sessions
  fastify.get('/sessions', async () => {
    return {
      sessions: Array.from(sessions.values()),
      total: sessions.size
    };
  });

  // GET /api/sessions/:id - Get session by ID
  fastify.get<{ Params: { id: string } }>('/sessions/:id', async (request, reply) => {
    const { id } = request.params;
    const session = sessions.get(id);

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    return session;
  });

  // POST /api/sessions - Create new session
  fastify.post<{ Body: CreateSessionBody }>('/sessions', async (request, reply) => {
    const { taskId, executorType } = request.body;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const session: Session = {
      id,
      taskId,
      executorType,
      status: 'active',
      messages: [],
      createdAt: now,
      updatedAt: now
    };

    sessions.set(id, session);

    return reply.status(201).send(session);
  });

  // DELETE /api/sessions/:id - End/delete session
  fastify.delete<{ Params: { id: string } }>('/sessions/:id', async (request, reply) => {
    const { id } = request.params;

    if (!sessions.has(id)) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    sessions.delete(id);

    return reply.status(204).send();
  });

  // POST /api/sessions/:id/queue - Queue a message to the session
  fastify.post<{ Params: { id: string }; Body: QueueMessageBody }>(
    '/sessions/:id/queue',
    async (request, reply) => {
      const { id } = request.params;
      const { content } = request.body;

      const session = sessions.get(id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const message: SessionMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: new Date().toISOString()
      };

      session.messages.push(message);
      session.updatedAt = new Date().toISOString();
      sessions.set(id, session);

      // TODO: Actually send to executor and get response
      fastify.log.info(`Queued message to session ${id}: ${content.substring(0, 50)}...`);

      return {
        sessionId: id,
        messageId: message.id,
        status: 'queued'
      };
    }
  );

  // GET /api/sessions/:id/messages - Get session messages
  fastify.get<{ Params: { id: string } }>('/sessions/:id/messages', async (request, reply) => {
    const { id } = request.params;

    const session = sessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    return {
      sessionId: id,
      messages: session.messages,
      total: session.messages.length
    };
  });

  // POST /api/sessions/:id/pause - Pause session
  fastify.post<{ Params: { id: string } }>('/sessions/:id/pause', async (request, reply) => {
    const { id } = request.params;

    const session = sessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    session.status = 'paused';
    session.updatedAt = new Date().toISOString();
    sessions.set(id, session);

    return { sessionId: id, status: 'paused' };
  });

  // POST /api/sessions/:id/resume - Resume session
  fastify.post<{ Params: { id: string } }>('/sessions/:id/resume', async (request, reply) => {
    const { id } = request.params;

    const session = sessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    session.status = 'active';
    session.updatedAt = new Date().toISOString();
    sessions.set(id, session);

    return { sessionId: id, status: 'active' };
  });
};
