/**
 * Stdout duplication - pipe child process output to multiple destinations
 * Translates: crates/utils/src/stdout_dup.rs
 */

import { ChildProcess } from 'node:child_process';
import { PassThrough, Writable } from 'node:stream';

export interface StdoutDupOptions {
  /** Whether to also write to the parent process stdout */
  passthrough?: boolean;
  /** Maximum buffer size per destination in bytes */
  maxBufferSize?: number;
}

/**
 * Duplicate stdout/stderr from a child process to multiple destinations
 */
export class StdoutDup {
  private destinations: Writable[] = [];
  private buffers: Map<Writable, Buffer[]> = new Map();
  private closed = false;

  constructor(private options: StdoutDupOptions = {}) {}

  /** Add a destination stream */
  addDestination(dest: Writable): void {
    this.destinations.push(dest);
    this.buffers.set(dest, []);
  }

  /** Remove a destination stream */
  removeDestination(dest: Writable): void {
    const idx = this.destinations.indexOf(dest);
    if (idx >= 0) {
      this.destinations.splice(idx, 1);
      this.buffers.delete(dest);
    }
  }

  /** Pipe a child process's stdout and stderr */
  pipe(child: ChildProcess): void {
    child.stdout?.on('data', (data: Buffer) => {
      this.write(data);
    });

    child.stderr?.on('data', (data: Buffer) => {
      this.write(data);
    });

    child.on('close', () => {
      this.close();
    });
  }

  /** Write data to all destinations */
  private write(data: Buffer): void {
    if (this.closed) return;

    if (this.options.passthrough) {
      process.stdout.write(data);
    }

    for (const dest of this.destinations) {
      try {
        dest.write(data);
      } catch {
        // Destination may be closed
      }
    }
  }

  /** Close all destinations */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    for (const dest of this.destinations) {
      try {
        dest.end();
      } catch {
        // Ignore
      }
    }
  }
}

/**
 * Create a pass-through stream that captures output
 */
export function createCaptureStream(): { stream: PassThrough; getOutput(): string } {
  const chunks: Buffer[] = [];
  const stream = new PassThrough();

  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  return {
    stream,
    getOutput() {
      return Buffer.concat(chunks).toString('utf-8');
    },
  };
}
