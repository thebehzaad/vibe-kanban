/**
 * Entry Index Provider for thread-safe monotonic indexing
 * Translates: crates/executors/src/logs/utils/entry_index.rs
 */

/**
 * Provider for monotonically increasing entry indexes.
 * In Rust this uses AtomicUsize; in TS we use a simple counter
 * (JS is single-threaded so atomicity isn't needed).
 */
export class EntryIndexProvider {
  private counter: number;

  private constructor(start: number = 0) {
    this.counter = start;
  }

  static create(): EntryIndexProvider {
    return new EntryIndexProvider(0);
  }

  next(): number {
    return this.counter++;
  }

  current(): number {
    return this.counter;
  }

  reset(): void {
    this.counter = 0;
  }

  /**
   * Create a provider starting from the maximum existing normalized-entry index
   * observed in prior JSON patches.
   */
  static startFrom(patches: Array<{ op: string; path: string }>): EntryIndexProvider {
    let maxIndex = -1;

    for (const patch of patches) {
      if (patch.op === 'add') {
        const match = patch.path.match(/^\/entries\/(\d+)$/);
        if (match?.[1]) {
          const idx = parseInt(match[1], 10);
          if (idx > maxIndex) {
            maxIndex = idx;
          }
        }
      }
    }

    const startAt = maxIndex >= 0 ? maxIndex + 1 : 0;
    return new EntryIndexProvider(startAt);
  }
}
