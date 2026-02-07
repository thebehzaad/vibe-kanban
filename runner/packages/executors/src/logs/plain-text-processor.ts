/**
 * Plain text log processor
 * Translates: crates/executors/src/logs/plain_text_processor.rs
 *
 * Clusters messages into entries based on configurable size and time-gap heuristics.
 */

import type { NormalizedEntry } from './index.js';
import { EntryIndexProvider } from './utils/entry-index.js';
import { ConversationPatch, type Patch } from './utils/patch.js';

// --- MessageBoundary ---

export type MessageBoundary =
  | { type: 'split'; lineIndex: number }
  | { type: 'incomplete_content' };

// --- Type aliases for callbacks ---

export type FormatChunkFn = (partialLine: string | undefined, chunk: string) => string;
export type MessageBoundaryPredicateFn = (lines: string[]) => MessageBoundary | undefined;
export type NormalizedEntryProducerFn = (content: string) => NormalizedEntry;
export type LinesTransformFn = (lines: string[]) => string[];

// --- PlainTextBuffer ---

class PlainTextBuffer {
  private _lines: string[] = [];
  private _totalLen = 0;

  ingest(textChunk: string): void {
    // Handle partial line continuation
    const lastLine = this._lines[this._lines.length - 1];
    if (lastLine !== undefined && !lastLine.endsWith('\n')) {
      this._lines.pop();
      this._totalLen -= lastLine.length;
      const combined = lastLine + textChunk;
      const parts = combined.split(/(?<=\n)/);
      this._lines.push(...parts);
      this._totalLen += combined.length;
    } else {
      const parts = textChunk.split(/(?<=\n)/);
      this._lines.push(...parts);
      this._totalLen += textChunk.length;
    }
  }

  drainLines(n: number): string[] {
    const count = Math.min(n, this._lines.length);
    const drained = this._lines.splice(0, count);
    for (const line of drained) {
      this._totalLen -= line.length;
    }
    return drained;
  }

  drainSize(len: number): string[] {
    let drainedLen = 0;
    let linesToDrain = 0;
    for (const line of this._lines) {
      if (drainedLen >= len && linesToDrain > 0) break;
      drainedLen += line.length;
      linesToDrain++;
    }
    return this.drainLines(linesToDrain);
  }

  flush(): string[] {
    const result = [...this._lines];
    this._lines = [];
    this._totalLen = 0;
    return result;
  }

  get totalLen(): number {
    return this._totalLen;
  }

  get lines(): string[] {
    return this._lines;
  }

  set lines(newLines: string[]) {
    this._lines = newLines;
    this.recomputeLen();
  }

  recomputeLen(): void {
    this._totalLen = this._lines.reduce((sum, s) => sum + s.length, 0);
  }

  get partialLine(): string | undefined {
    const last = this._lines[this._lines.length - 1];
    if (last !== undefined && !last.endsWith('\n')) {
      return last;
    }
    return undefined;
  }

  get isEmpty(): boolean {
    return this._totalLen === 0;
  }
}

// --- PlainTextLogProcessor ---

export interface PlainTextLogProcessorOptions {
  normalizedEntryProducer: NormalizedEntryProducerFn;
  indexProvider: EntryIndexProvider;
  sizeThreshold?: number;
  timeGap?: number; // milliseconds
  formatChunk?: FormatChunkFn;
  transformLines?: LinesTransformFn;
  messageBoundaryPredicate?: MessageBoundaryPredicateFn;
}

export class PlainTextLogProcessor {
  private buffer = new PlainTextBuffer();
  private indexProvider: EntryIndexProvider;
  private entrySizeThreshold: number | undefined;
  private timeGap: number | undefined;
  private formatChunk: FormatChunkFn | undefined;
  private transformLines: LinesTransformFn | undefined;
  private messageBoundaryPredicate: MessageBoundaryPredicateFn | undefined;
  private normalizedEntryProducer: NormalizedEntryProducerFn;
  private lastChunkArrivalTime: number;
  private currentEntryIndex: number | undefined;

  constructor(options: PlainTextLogProcessorOptions) {
    this.indexProvider = options.indexProvider;
    this.normalizedEntryProducer = options.normalizedEntryProducer;
    this.formatChunk = options.formatChunk;
    this.transformLines = options.transformLines;
    this.messageBoundaryPredicate = options.messageBoundaryPredicate;
    this.timeGap = options.timeGap;
    this.lastChunkArrivalTime = Date.now();

    // Default 8KiB when neither size nor time gap is set
    if (options.sizeThreshold === undefined && options.timeGap === undefined) {
      this.entrySizeThreshold = 8 * 1024;
    } else {
      this.entrySizeThreshold = options.sizeThreshold;
    }

    this.currentEntryIndex = undefined;
  }

  process(textChunk: string): Patch[] {
    if (!textChunk) return [];

    if (!this.buffer.isEmpty) {
      if (this.timeGap !== undefined && Date.now() - this.lastChunkArrivalTime >= this.timeGap) {
        const lines = this.buffer.flush();
        if (lines.length > 0) {
          const patch = this.createPatch(lines);
          this.currentEntryIndex = undefined;
          return [patch];
        }
        this.currentEntryIndex = undefined;
      }
    }

    this.lastChunkArrivalTime = Date.now();

    const formattedChunk = this.formatChunk
      ? this.formatChunk(this.buffer.partialLine, textChunk)
      : textChunk;

    if (!formattedChunk) return [];

    this.buffer.ingest(formattedChunk);

    if (this.transformLines) {
      this.buffer.lines = this.transformLines(this.buffer.lines);
      this.buffer.recomputeLen();
      if (this.buffer.isEmpty) return [];
    }

    const patches: Patch[] = [];

    // Check message boundary predicate
    while (true) {
      const boundary = this.messageBoundaryPredicate?.(this.buffer.lines);

      if (boundary?.type === 'split') {
        const lines = this.buffer.drainLines(boundary.lineIndex);
        if (lines.length > 0) {
          patches.push(this.createPatch(lines));
          this.currentEntryIndex = undefined;
        }
      } else if (boundary?.type === 'incomplete_content') {
        return patches;
      } else {
        break;
      }
    }

    // Size-based splitting
    if (this.entrySizeThreshold !== undefined) {
      while (this.buffer.totalLen >= this.entrySizeThreshold) {
        const lines = this.buffer.drainSize(this.entrySizeThreshold);
        if (lines.length === 0) break;
        patches.push(this.createPatch(lines));
        this.currentEntryIndex = undefined;
      }
    }

    // Send partial updates
    if (!this.buffer.isEmpty) {
      patches.push(this.createPatch([...this.buffer.lines]));
    }

    return patches;
  }

  private createPatch(lines: string[]): Patch {
    const content = lines.join('');
    const entry = this.normalizedEntryProducer(content);

    const added = this.currentEntryIndex !== undefined;
    const index = this.currentEntryIndex ?? this.indexProvider.next();
    this.currentEntryIndex = index;

    if (!added) {
      return ConversationPatch.addNormalizedEntry(index, entry);
    } else {
      return ConversationPatch.replace(index, entry);
    }
  }
}
