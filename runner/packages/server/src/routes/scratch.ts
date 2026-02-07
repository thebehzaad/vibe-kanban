/**
 * Scratch (notes/storage) routes
 * Translates: crates/server/src/routes/scratch.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ScratchRepository, type ScratchType, type ScratchItem } from '@runner/db';
import type { Deployment } from '@runner/deployment';

// Re-export types for consumers that import from routes
export type { ScratchType, ScratchItem } from '@runner/db';

// Body types for request validation
export interface CreateScratchBody {
  value: unknown;
  metadata?: Record<string, unknown>;
}

export interface UpdateScratchBody {
  value: unknown;
  metadata?: Record<string, unknown>;
}

// WebSocket subscribers for change streaming
const scratchSubscribers = new Map<string, Set<any>>(); // "type:key" -> sockets

function getScratchKey(type: string, key: string): string {
  return `${type}:${key}`;
}

export const scratchRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const db = () => fastify.deployment.db();
  const getRepo = () => new ScratchRepository(db());

  // GET /api/scratch - List all scratch items
  fastify.get<{ Querystring: { type?: ScratchType } }>('/scratch', async (request) => {
    const { type } = request.query;
    const repo = getRepo();
    const items = repo.findAll(type);

    return {
      items,
      total: items.length
    };
  });

  // GET /api/scratch/:type/:id - Get scratch item
  fastify.get<{ Params: { scratch_type: string; id: string } }>(
    '/scratch/:scratch_type/:id',
    async (request, reply) => {
      const { scratch_type, id } = request.params;
      const repo = getRepo();
      const item = repo.findByTypeAndKey(scratch_type, id);

      if (!item) {
        return reply.status(404).send({ error: 'Scratch item not found' });
      }

      return item;
    }
  );

  // POST /api/scratch/:type/:id - Create scratch item
  fastify.post<{ Params: { scratch_type: string; id: string }; Body: CreateScratchBody }>(
    '/scratch/:scratch_type/:id',
    async (request, reply) => {
      const { scratch_type, id } = request.params;
      const { value, metadata } = request.body;
      const repo = getRepo();

      // Check if already exists
      const existing = repo.findByTypeAndKey(scratch_type, id);
      if (existing) {
        return reply.status(409).send({ error: 'Scratch item already exists' });
      }

      const item = repo.create(
        { type: scratch_type as ScratchType, key: id, value, metadata },
      );

      // Notify subscribers
      notifyScratchChange(scratch_type, id, 'created', item);

      fastify.log.info(`Scratch item created: ${scratch_type}/${id}`);

      return reply.status(201).send(item);
    }
  );

  // PUT /api/scratch/:type/:id - Update scratch item
  fastify.put<{ Params: { scratch_type: string; id: string }; Body: UpdateScratchBody }>(
    '/scratch/:scratch_type/:id',
    async (request, reply) => {
      const { scratch_type, id } = request.params;
      const { value, metadata } = request.body;
      const repo = getRepo();

      const existing = repo.findByTypeAndKey(scratch_type, id);

      if (existing) {
        // Update existing
        const updatedItem = repo.update(scratch_type, id, { value, metadata });

        // Notify subscribers
        notifyScratchChange(scratch_type, id, 'updated', updatedItem!);

        return updatedItem;
      } else {
        // Create new (upsert behavior)
        const newItem = repo.create(
          { type: scratch_type as ScratchType, key: id, value, metadata },
        );

        // Notify subscribers
        notifyScratchChange(scratch_type, id, 'created', newItem);

        return reply.status(201).send(newItem);
      }
    }
  );

  // DELETE /api/scratch/:type/:id - Delete scratch item
  fastify.delete<{ Params: { scratch_type: string; id: string } }>(
    '/scratch/:scratch_type/:id',
    async (request, reply) => {
      const { scratch_type, id } = request.params;
      const repo = getRepo();

      const changes = repo.delete(scratch_type, id);
      if (changes === 0) {
        return reply.status(404).send({ error: 'Scratch item not found' });
      }

      // Notify subscribers
      notifyScratchChange(scratch_type, id, 'deleted', null);

      fastify.log.info(`Scratch item deleted: ${scratch_type}/${id}`);

      return reply.status(204).send();
    }
  );

  // GET /api/scratch/:type/:id/stream/ws - WebSocket stream for scratch changes
  fastify.get<{ Params: { scratch_type: string; id: string } }>(
    '/scratch/:scratch_type/:id/stream/ws',
    { websocket: true } as any,
    async (socket: any, request) => {
      const { scratch_type, id } = request.params;
      const key = getScratchKey(scratch_type, id);

      // Add subscriber
      if (!scratchSubscribers.has(key)) {
        scratchSubscribers.set(key, new Set());
      }
      scratchSubscribers.get(key)!.add(socket);

      fastify.log.info(`Scratch WebSocket connected: ${key}`);

      // Send current value from DB
      const repo = getRepo();
      const item = repo.findByTypeAndKey(scratch_type, id);
      if (item) {
        socket.send(JSON.stringify({ type: 'initial', data: item }));
      }

      socket.on('close', () => {
        scratchSubscribers.get(key)?.delete(socket);
        fastify.log.info(`Scratch WebSocket disconnected: ${key}`);
      });
    }
  );
};

// Helper to notify subscribers
function notifyScratchChange(
  type: string,
  id: string,
  changeType: 'created' | 'updated' | 'deleted',
  item: ScratchItem | null
): void {
  const key = getScratchKey(type, id);
  const subscribers = scratchSubscribers.get(key);

  if (subscribers) {
    const message = JSON.stringify({ type: changeType, data: item });
    for (const socket of subscribers) {
      try {
        socket.send(message);
      } catch {
        subscribers.delete(socket);
      }
    }
  }
}

// Export helpers that accept a Deployment parameter (mirrors Rust pattern)
export function getScratchItem(deployment: Deployment, type: string, key: string): ScratchItem | undefined {
  const repo = new ScratchRepository(deployment.db());
  return repo.findByTypeAndKey(type, key);
}

export function setScratchItem(
  deployment: Deployment,
  type: string,
  key: string,
  value: unknown,
  metadata?: Record<string, unknown>
): ScratchItem {
  const repo = new ScratchRepository(deployment.db());
  return repo.upsert(type, key, value, metadata);
}
