/**
 * Stdout duplication utility for child processes
 * Translates: crates/executors/src/stdout_dup.rs
 *
 * In Rust, this uses OS-level file descriptor duplication.
 * In Node.js, we use stream piping/teeing instead.
 */

import type { ChildProcess } from 'node:child_process';
import { Readable, PassThrough } from 'node:stream';

/**
 * Duplicate stdout from a child process.
 * Returns a readable stream that mirrors stdout.
 */
export function duplicateStdout(child: ChildProcess): Readable {
  if (!child.stdout) {
    throw new Error('Child process has no stdout');
  }

  const duplicate = new PassThrough();
  child.stdout.pipe(duplicate);

  return duplicate;
}

/**
 * Handle to append additional lines into a stream.
 */
export class StdoutAppender {
  private writable: PassThrough;

  constructor(writable: PassThrough) {
    this.writable = writable;
  }

  appendLine(line: string): void {
    let cleaned = line;
    while (cleaned.endsWith('\n') || cleaned.endsWith('\r')) {
      cleaned = cleaned.slice(0, -1);
    }
    this.writable.write(cleaned + '\n');
  }
}

/**
 * Tee the child's stdout and provide both a duplicate stream and an appender
 * to write additional lines.
 */
export function teeStdoutWithAppender(
  child: ChildProcess,
): { duplicate: Readable; appender: StdoutAppender } {
  if (!child.stdout) {
    throw new Error('Child process has no stdout');
  }

  const duplicate = new PassThrough();
  child.stdout.pipe(duplicate);

  const appender = new StdoutAppender(duplicate);
  return { duplicate, appender };
}
