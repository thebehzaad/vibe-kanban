/**
 * Queued message service
 * Translates: crates/services/src/queued_message.rs
 *
 * In-memory service for managing queued follow-up messages.
 * One queued message per session.
 */

import type { DraftFollowUpData } from '@runner/db';

// ── Types ──

/** Represents a queued follow-up message for a session */
export interface QueuedMessage {
  /** The session this message is queued for */
  sessionId: string;
  /** The follow-up data (message + variant) */
  data: DraftFollowUpData;
  /** Timestamp when the message was queued */
  queuedAt: Date;
}

/** Status of the queue for a session (for frontend display) */
export type QueueStatus =
  | { status: 'empty' }
  | { status: 'queued'; message: QueuedMessage };

// ── Service ──

export class QueuedMessageService {
  private queue = new Map<string, QueuedMessage>();

  /** Queue a message for a session. Replaces any existing queued message. */
  queueMessage(sessionId: string, data: DraftFollowUpData): QueuedMessage {
    const queued: QueuedMessage = {
      sessionId,
      data,
      queuedAt: new Date(),
    };
    this.queue.set(sessionId, queued);
    return queued;
  }

  /** Cancel/remove a queued message for a session */
  cancelQueued(sessionId: string): QueuedMessage | undefined {
    const msg = this.queue.get(sessionId);
    if (msg) {
      this.queue.delete(sessionId);
    }
    return msg;
  }

  /** Get the queued message for a session (if any) */
  getQueued(sessionId: string): QueuedMessage | undefined {
    const msg = this.queue.get(sessionId);
    return msg ? { ...msg } : undefined;
  }

  /** Take (remove and return) the queued message for a session.
   *  Used by finalization flow to consume the queued message. */
  takeQueued(sessionId: string): QueuedMessage | undefined {
    const msg = this.queue.get(sessionId);
    if (msg) {
      this.queue.delete(sessionId);
    }
    return msg;
  }

  /** Check if a session has a queued message */
  hasQueued(sessionId: string): boolean {
    return this.queue.has(sessionId);
  }

  /** Get queue status for frontend display */
  getStatus(sessionId: string): QueueStatus {
    const msg = this.getQueued(sessionId);
    if (msg) {
      return { status: 'queued', message: msg };
    }
    return { status: 'empty' };
  }
}
