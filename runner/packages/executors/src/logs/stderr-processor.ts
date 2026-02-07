/**
 * Standard stderr log processor for executors
 * Translates: crates/executors/src/logs/stderr_processor.rs
 *
 * Uses PlainTextLogProcessor with a 2-second time gap to split stderr streams into entries.
 * Each entry is normalized as ErrorMessage.
 */

import { PlainTextLogProcessor } from './plain-text-processor.js';
import { EntryIndexProvider } from './utils/entry-index.js';
import type { NormalizedEntry } from './index.js';

/**
 * Create a stderr log normalizer that splits stderr output into discrete entries
 * based on a 2-second time gap threshold.
 */
export function createStderrProcessor(
  entryIndexProvider: EntryIndexProvider,
): PlainTextLogProcessor {
  return new PlainTextLogProcessor({
    normalizedEntryProducer: (content: string): NormalizedEntry => ({
      timestamp: undefined,
      entryType: {
        type: 'error_message',
        errorType: { type: 'other' },
      },
      content: stripAnsiEscapes(content),
      metadata: undefined,
    }),
    timeGap: 2000, // 2 seconds between messages
    indexProvider: entryIndexProvider,
  });
}

/**
 * Strip ANSI escape sequences from a string.
 */
function stripAnsiEscapes(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}
