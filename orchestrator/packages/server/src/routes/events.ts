/**
 * Events routes (Server-Sent Events)
 * Translates: crates/server/src/routes/events.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';

// Event types
export type EventType =
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'workspace.created'
  | 'workspace.updated'
  | 'workspace.deleted'
  | 'workspace.archived'
  | 'session.created'
  | 'session.updated'
  | 'session.message'
  | 'execution.started'
  | 'execution.progress'
  | 'execution.completed'
  | 'execution.failed'
  | 'execution.log'
  | 'approval.requested'
  | 'approval.responded'
  | 'diff.updated'
  | 'branch.updated'
  | 'pr.created'
  | 'pr.updated'
  | 'config.changed'
  | 'heartbeat';

export interface ServerEvent<T = unknown> {
  id: string;
  type: EventType;
  timestamp: string;
  data: T;
}

// Event emitter for broadcasting
type EventListener = (event: ServerEvent) => void;
const listeners = new Set<EventListener>();
const eventHistory: ServerEvent[] = [];
const MAX_HISTORY = 1000;

// Emit event to all listeners
export function emitEvent<T>(type: EventType, data: T): void {
  const event: ServerEvent<T> = {
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    data
  };

  // Add to history
  eventHistory.push(event);
  if (eventHistory.length > MAX_HISTORY) {
    eventHistory.shift();
  }

  // Broadcast to all listeners
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('Error in event listener:', err);
    }
  }
}

export const eventRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/events - Server-Sent Events stream
  fastify.get<{ Querystring: { last_event_id?: string } }>(
    '/events/',
    async (request, reply) => {
      const { last_event_id } = request.query;

      // Set SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // Disable nginx buffering
      });

      // Send any missed events from history
      if (last_event_id) {
        const lastIndex = eventHistory.findIndex(e => e.id === last_event_id);
        if (lastIndex !== -1) {
          const missedEvents = eventHistory.slice(lastIndex + 1);
          for (const event of missedEvents) {
            sendSSEEvent(reply.raw, event);
          }
        }
      }

      // Register listener for new events
      const listener: EventListener = (event) => {
        sendSSEEvent(reply.raw, event);
      };
      listeners.add(listener);

      // Send heartbeat every 30 seconds
      const heartbeatInterval = setInterval(() => {
        emitEvent('heartbeat', { timestamp: new Date().toISOString() });
      }, 30000);

      // Cleanup on connection close
      request.raw.on('close', () => {
        listeners.delete(listener);
        clearInterval(heartbeatInterval);
        fastify.log.info('SSE client disconnected');
      });

      fastify.log.info('SSE client connected');

      // Send initial connection event
      sendSSEEvent(reply.raw, {
        id: crypto.randomUUID(),
        type: 'heartbeat',
        timestamp: new Date().toISOString(),
        data: { connected: true }
      });

      // Keep connection open (don't return response)
      return reply;
    }
  );

  // GET /api/events/history - Get event history
  fastify.get<{ Querystring: { limit?: number; type?: EventType } }>(
    '/events/history',
    async (request) => {
      const { limit = 100, type } = request.query;

      let events = eventHistory;

      if (type) {
        events = events.filter(e => e.type === type);
      }

      // Return most recent events
      events = events.slice(-limit);

      return {
        events,
        total: events.length
      };
    }
  );
};

// Helper to send SSE formatted event
function sendSSEEvent(res: any, event: ServerEvent): void {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

// Re-export for use by other modules
export { listeners as eventListeners };
