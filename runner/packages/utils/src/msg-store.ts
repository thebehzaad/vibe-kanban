/**
 * MsgStore - In-memory message storage for log streaming
 * Translates: crates/utils/src/msg_store.rs
 */

import type { LogMsg } from './log-msg.js';

export interface MsgStoreEntry {
  index: number;
  msg: LogMsg;
  timestamp: Date;
}

export interface MsgStoreStream {
  /** Read all entries from a given index */
  readFrom(fromIndex: number): MsgStoreEntry[];
  /** Subscribe to new entries via async iterator */
  subscribe(fromIndex: number): AsyncIterable<MsgStoreEntry>;
  /** Close the stream */
  close(): void;
}

/**
 * In-memory message store for streaming logs between producer and consumers.
 * Supports multiple concurrent readers with independent cursors.
 */
export class MsgStore {
  private entries: MsgStoreEntry[] = [];
  private sessionId: string | undefined;
  private listeners: Set<(entry: MsgStoreEntry) => void> = new Set();
  private closed = false;

  constructor(readonly id: string) {}

  /** Get the current session ID */
  getSessionId(): string | undefined {
    return this.sessionId;
  }

  /** Set the session ID */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /** Get the current number of entries */
  get length(): number {
    return this.entries.length;
  }

  /** Get the next index that will be assigned */
  get nextIndex(): number {
    return this.entries.length;
  }

  /** Check if the store has been closed */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Push a message to the store */
  push(msg: LogMsg): number {
    const entry: MsgStoreEntry = {
      index: this.entries.length,
      msg,
      timestamp: new Date(),
    };
    this.entries.push(entry);

    // Notify all listeners
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // Ignore listener errors
      }
    }

    return entry.index;
  }

  /** Get all entries from a given index */
  readFrom(fromIndex: number): MsgStoreEntry[] {
    if (fromIndex >= this.entries.length) return [];
    return this.entries.slice(Math.max(0, fromIndex));
  }

  /** Get a specific entry by index */
  get(index: number): MsgStoreEntry | undefined {
    return this.entries[index];
  }

  /** Get all entries */
  getAll(): MsgStoreEntry[] {
    return [...this.entries];
  }

  /** Get the history (all entries) */
  history(): MsgStoreEntry[] {
    return [...this.entries];
  }

  /** Create a stream that reads from a given index */
  createStream(fromIndex: number = 0): MsgStoreStream {
    const store = this;
    let streamClosed = false;

    return {
      readFrom(from: number): MsgStoreEntry[] {
        return store.readFrom(from);
      },

      async *subscribe(from: number): AsyncIterable<MsgStoreEntry> {
        // First yield any existing entries
        const existing = store.readFrom(from);
        let nextIdx = from;
        for (const entry of existing) {
          yield entry;
          nextIdx = entry.index + 1;
        }

        // Then wait for new entries
        while (!streamClosed && !store.closed) {
          const entry = await new Promise<MsgStoreEntry | null>((resolve) => {
            // Check if there are already new entries
            if (nextIdx < store.entries.length) {
              const foundEntry = store.entries[nextIdx];
              if (foundEntry) {
                resolve(foundEntry);
              } else {
                resolve(null);
              }
              return;
            }

            if (store.closed) {
              resolve(null);
              return;
            }

            const listener = (e: MsgStoreEntry) => {
              if (e.index >= nextIdx) {
                store.listeners.delete(listener);
                resolve(e);
              }
            };
            store.listeners.add(listener);

            // Also listen for close
            const checkClosed = setInterval(() => {
              if (store.closed || streamClosed) {
                clearInterval(checkClosed);
                store.listeners.delete(listener);
                resolve(null);
              }
            }, 100);
          });

          if (entry === null) break;
          yield entry;
          nextIdx = entry.index + 1;
        }
      },

      close() {
        streamClosed = true;
      },
    };
  }

  /** Close the store - no more messages can be pushed */
  close(): void {
    this.closed = true;
    // Notify all listeners to clean up
    this.listeners.clear();
  }
}

/**
 * Map of MsgStores keyed by execution ID
 */
export class MsgStoreMap {
  private stores: Map<string, MsgStore> = new Map();

  /** Get or create a store for the given ID */
  getOrCreate(id: string): MsgStore {
    let store = this.stores.get(id);
    if (!store) {
      store = new MsgStore(id);
      this.stores.set(id, store);
    }
    return store;
  }

  /** Get a store by ID */
  get(id: string): MsgStore | undefined {
    return this.stores.get(id);
  }

  /** Check if a store exists */
  has(id: string): boolean {
    return this.stores.has(id);
  }

  /** Remove a store */
  remove(id: string): void {
    const store = this.stores.get(id);
    if (store) {
      store.close();
      this.stores.delete(id);
    }
  }

  /** Get all store IDs */
  keys(): string[] {
    return [...this.stores.keys()];
  }

  /** Get all stores */
  values(): MsgStore[] {
    return [...this.stores.values()];
  }

  /** Get the number of stores */
  get size(): number {
    return this.stores.size;
  }
}
