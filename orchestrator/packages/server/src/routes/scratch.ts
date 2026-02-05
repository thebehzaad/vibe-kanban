/**
 * Scratch (notes/storage) routes
 * Translates: crates/server/src/routes/scratch.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as crypto from 'node:crypto';

// Types
export type ScratchType =
  | 'note'
  | 'snippet'
  | 'todo'
  | 'bookmark'
  | 'preference'
  | 'ui_state'
  | 'custom';

export interface ScratchItem {
  id: string;
  type: ScratchType;
  key: string;
  value: unknown;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScratchBody {
  value: unknown;
  metadata?: Record<string, unknown>;
}

export interface UpdateScratchBody {
  value: unknown;
  metadata?: Record<string, unknown>;
}

// In-memory store: type -> key -> item
const scratchStore = new Map<string, Map<string, ScratchItem>>();

// WebSocket subscribers for change streaming
const scratchSubscribers = new Map<string, Set<any>>(); // "type:id" -> sockets

function getScratchKey(type: string, id: string): string {
  return `${type}:${id}`;
}

export const scratchRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/scratch - List all scratch items
  fastify.get<{ Querystring: { type?: ScratchType } }>('/scratch', async (request) => {
    const { type } = request.query;

    const items: ScratchItem[] = [];

    if (type) {
      const typeStore = scratchStore.get(type);
      if (typeStore) {
        items.push(...typeStore.values());
      }
    } else {
      for (const typeStore of scratchStore.values()) {
        items.push(...typeStore.values());
      }
    }

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

      const typeStore = scratchStore.get(scratch_type);
      const item = typeStore?.get(id);

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

      let typeStore = scratchStore.get(scratch_type);
      if (!typeStore) {
        typeStore = new Map();
        scratchStore.set(scratch_type, typeStore);
      }

      // Check if already exists
      if (typeStore.has(id)) {
        return reply.status(409).send({ error: 'Scratch item already exists' });
      }

      const now = new Date().toISOString();
      const item: ScratchItem = {
        id,
        type: scratch_type as ScratchType,
        key: id,
        value,
        metadata,
        createdAt: now,
        updatedAt: now
      };

      typeStore.set(id, item);

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

      const typeStore = scratchStore.get(scratch_type);
      const existingItem = typeStore?.get(id);

      const now = new Date().toISOString();

      if (existingItem) {
        // Update existing
        const updatedItem: ScratchItem = {
          ...existingItem,
          value,
          metadata: metadata ?? existingItem.metadata,
          updatedAt: now
        };

        typeStore!.set(id, updatedItem);

        // Notify subscribers
        notifyScratchChange(scratch_type, id, 'updated', updatedItem);

        return updatedItem;
      } else {
        // Create new (upsert behavior)
        let store = typeStore;
        if (!store) {
          store = new Map();
          scratchStore.set(scratch_type, store);
        }

        const newItem: ScratchItem = {
          id,
          type: scratch_type as ScratchType,
          key: id,
          value,
          metadata,
          createdAt: now,
          updatedAt: now
        };

        store.set(id, newItem);

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

      const typeStore = scratchStore.get(scratch_type);
      if (!typeStore?.has(id)) {
        return reply.status(404).send({ error: 'Scratch item not found' });
      }

      typeStore.delete(id);

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

      // Send current value
      const typeStore = scratchStore.get(scratch_type);
      const item = typeStore?.get(id);
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

// Export helpers
export function getScratchItem(type: string, id: string): ScratchItem | undefined {
  return scratchStore.get(type)?.get(id);
}

export function setScratchItem(type: string, id: string, value: unknown, metadata?: Record<string, unknown>): ScratchItem {
  let typeStore = scratchStore.get(type);
  if (!typeStore) {
    typeStore = new Map();
    scratchStore.set(type, typeStore);
  }

  const existing = typeStore.get(id);
  const now = new Date().toISOString();

  const item: ScratchItem = {
    id,
    type: type as ScratchType,
    key: id,
    value,
    metadata,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  typeStore.set(id, item);
  notifyScratchChange(type, id, existing ? 'updated' : 'created', item);

  return item;
}
