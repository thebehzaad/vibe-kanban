/**
 * Events service - Real-time event streaming
 * Translates: crates/services/src/events.rs
 */

export type EventType =
  | 'task.created'
  | 'task.updated'
  | 'task.completed'
  | 'task.deleted'
  | 'workspace.created'
  | 'workspace.updated'
  | 'workspace.deleted'
  | 'workspace.archived'
  | 'execution.started'
  | 'execution.completed'
  | 'execution.failed'
  | 'execution.stopped'
  | 'execution.log'
  | 'approval.requested'
  | 'approval.responded'
  | 'file.changed'
  | 'git.commit'
  | 'git.push'
  | 'session.created'
  | 'session.updated';

export interface Event<T = unknown> {
  id: string;
  type: EventType;
  timestamp: Date;
  payload: T;
}

export type EventHandler<T = unknown> = (event: Event<T>) => void | Promise<void>;

export interface EventStream {
  id: string;
  types?: EventType[];
  handler: EventHandler;
}

export interface SSEClient {
  id: string;
  send(event: Event): void;
  close(): void;
}

/**
 * EventsService provides real-time event streaming using pub/sub.
 * Supports SSE and WebSocket consumers, with event filtering and history.
 */
export class EventsService {
  private handlers: Map<EventType, Set<EventHandler>> = new Map();
  private globalHandlers: Set<EventHandler> = new Set();
  private eventHistory: Event[] = [];
  private maxHistorySize = 1000;
  private sseClients: Map<string, SSEClient> = new Map();
  private streams: Map<string, EventStream> = new Map();

  /** Subscribe to a specific event type */
  subscribe<T>(eventType: EventType, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler as EventHandler);

    return () => {
      this.handlers.get(eventType)?.delete(handler as EventHandler);
    };
  }

  /** Subscribe to all events */
  subscribeAll(handler: EventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => {
      this.globalHandlers.delete(handler);
    };
  }

  /** Create a named event stream with optional type filtering */
  createStream(id: string, types?: EventType[]): EventStream {
    const stream: EventStream = {
      id,
      types,
      handler: () => {},
    };
    this.streams.set(id, stream);
    return stream;
  }

  /** Remove an event stream */
  removeStream(id: string): void {
    this.streams.delete(id);
  }

  /** Emit an event to all subscribers */
  async emit<T>(eventType: EventType, payload: T): Promise<void> {
    const event: Event<T> = {
      id: crypto.randomUUID(),
      type: eventType,
      timestamp: new Date(),
      payload,
    };

    // Store in history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }

    // Notify type-specific handlers
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      const promises = [...handlers].map(handler => {
        try {
          return Promise.resolve(handler(event));
        } catch (err) {
          console.error(`Event handler error for ${eventType}:`, err);
          return Promise.resolve();
        }
      });
      await Promise.allSettled(promises);
    }

    // Notify global handlers
    for (const handler of this.globalHandlers) {
      try {
        await handler(event);
      } catch (err) {
        console.error('Global event handler error:', err);
      }
    }

    // Notify SSE clients
    for (const client of this.sseClients.values()) {
      try {
        client.send(event);
      } catch {
        // Client may be disconnected
      }
    }

    // Notify streams
    for (const stream of this.streams.values()) {
      if (!stream.types || stream.types.includes(eventType)) {
        try {
          await stream.handler(event);
        } catch {
          // Ignore stream errors
        }
      }
    }
  }

  // ─── SSE Support ──────────────────────────────────────────────────

  /** Register an SSE client */
  registerSSEClient(client: SSEClient): void {
    this.sseClients.set(client.id, client);
  }

  /** Remove an SSE client */
  removeSSEClient(clientId: string): void {
    const client = this.sseClients.get(clientId);
    if (client) {
      try { client.close(); } catch { /* ignore */ }
      this.sseClients.delete(clientId);
    }
  }

  /** Get the number of connected SSE clients */
  get sseClientCount(): number {
    return this.sseClients.size;
  }

  // ─── History ──────────────────────────────────────────────────────

  /** Get recent event history */
  getHistory(count?: number, types?: EventType[]): Event[] {
    let events = this.eventHistory;
    if (types && types.length > 0) {
      events = events.filter(e => types.includes(e.type));
    }
    if (count) {
      events = events.slice(-count);
    }
    return events;
  }

  /** Get events since a given event ID */
  getEventsSince(eventId: string): Event[] {
    const idx = this.eventHistory.findIndex(e => e.id === eventId);
    if (idx === -1) return [...this.eventHistory];
    return this.eventHistory.slice(idx + 1);
  }

  /** Clear event history */
  clearHistory(): void {
    this.eventHistory = [];
  }

  // ─── Per-Workspace/Session Streams ────────────────────────────────

  /** Create a workspace-scoped event stream */
  createWorkspaceStream(workspaceId: string, handler: EventHandler): () => void {
    const wrappedHandler: EventHandler = (event) => {
      const payload = event.payload as Record<string, unknown>;
      if (payload?.workspaceId === workspaceId) {
        return handler(event);
      }
    };
    this.globalHandlers.add(wrappedHandler);
    return () => { this.globalHandlers.delete(wrappedHandler); };
  }

  /** Create a session-scoped event stream */
  createSessionStream(sessionId: string, handler: EventHandler): () => void {
    const wrappedHandler: EventHandler = (event) => {
      const payload = event.payload as Record<string, unknown>;
      if (payload?.sessionId === sessionId) {
        return handler(event);
      }
    };
    this.globalHandlers.add(wrappedHandler);
    return () => { this.globalHandlers.delete(wrappedHandler); };
  }
}
