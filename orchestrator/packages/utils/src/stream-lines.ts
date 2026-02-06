/**
 * Stream line utilities
 * Translates: crates/utils/src/stream_lines.rs
 *
 * Utilities for streaming and processing lines of text.
 */

import { Readable } from 'node:stream';

export async function* streamLines(stream: Readable): AsyncGenerator<string> {
  let buffer = '';
  
  for await (const chunk of stream) {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      yield line;
    }
  }
  
  if (buffer) {
    yield buffer;
  }
}

export async function collectLines(stream: Readable): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of streamLines(stream)) {
    lines.push(line);
  }
  return lines;
}
