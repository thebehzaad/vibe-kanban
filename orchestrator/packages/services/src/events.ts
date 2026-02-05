/**
 * Events service
 * Translates: crates/services/src/events.rs
 */

export type EventType =
  | 'task.created'
  | 'task.updated'
  | 'task.completed'
  | 'execution.started'
  | 'execution.completed'
  | 'execution.failed'
  | 'file.changed'
  | 'git.commit';

export interface Event<T = unknown> {
  id: string;
  type: EventType;
  timestamp: Date;
  payload: T;
}

export type EventHandler<T = unknown> = (event: Event<T>) => void | Promise<void>;

export class EventsService {
  private handlers: Map<EventType, Set<EventHandler>> = new Map();

  subscribe<T>(eventType: EventType, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler as EventHandler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(eventType)?.delete(handler as EventHandler);
    };
  }

  async emit<T>(eventType: EventType, payload: T): Promise<void> {
    const event: Event<T> = {
      id: crypto.randomUUID(),
      type: eventType,
      timestamp: new Date(),
      payload
    };

    const handlers = this.handlers.get(eventType);
    if (handlers) {
      await Promise.all([...handlers].map((handler) => handler(event)));
    }
  }

  // TODO: Implement event streaming, persistence, etc.
}
