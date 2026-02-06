/**
 * Queued message service - Follow-up message queuing
 * Translates: crates/services/src/queued_message.rs
 */

export interface QueuedMessage {
  id: string;
  workspaceId: string;
  sessionId: string;
  prompt: string;
  createdAt: Date;
}

export class QueuedMessageService {
  private queues = new Map<string, QueuedMessage[]>();

  /** Queue a follow-up message for a workspace */
  enqueue(workspaceId: string, sessionId: string, prompt: string): QueuedMessage {
    const msg: QueuedMessage = {
      id: crypto.randomUUID(),
      workspaceId,
      sessionId,
      prompt,
      createdAt: new Date(),
    };

    if (!this.queues.has(workspaceId)) {
      this.queues.set(workspaceId, []);
    }
    this.queues.get(workspaceId)!.push(msg);

    return msg;
  }

  /** Dequeue the next message for a workspace */
  dequeue(workspaceId: string): QueuedMessage | undefined {
    const queue = this.queues.get(workspaceId);
    if (!queue || queue.length === 0) return undefined;
    return queue.shift();
  }

  /** Peek at the next message without removing it */
  peek(workspaceId: string): QueuedMessage | undefined {
    const queue = this.queues.get(workspaceId);
    return queue?.[0];
  }

  /** Check if a workspace has queued messages */
  hasMessages(workspaceId: string): boolean {
    const queue = this.queues.get(workspaceId);
    return !!queue && queue.length > 0;
  }

  /** Get all queued messages for a workspace */
  getAll(workspaceId: string): QueuedMessage[] {
    return this.queues.get(workspaceId) ?? [];
  }

  /** Clear all messages for a workspace */
  clear(workspaceId: string): void {
    this.queues.delete(workspaceId);
  }

  /** Clear all queues */
  clearAll(): void {
    this.queues.clear();
  }
}
