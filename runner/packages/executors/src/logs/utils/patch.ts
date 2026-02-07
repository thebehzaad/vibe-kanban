/**
 * JSON Patch helpers for conversation entries
 * Translates: crates/executors/src/logs/utils/patch.rs
 */

import type { Diff } from '@runner/utils';
import type { NormalizedEntry } from '../index.js';
import type { SlashCommandDescription } from '../../executors/index.js';
import { EntryIndexProvider } from './entry-index.js';

// --- PatchOperation ---

type PatchOperation = 'add' | 'replace' | 'remove';

// --- PatchType ---

type PatchType =
  | { type: 'NORMALIZED_ENTRY'; content: NormalizedEntry }
  | { type: 'STDOUT'; content: string }
  | { type: 'STDERR'; content: string }
  | { type: 'DIFF'; content: Diff };

// --- Patch (JSON Patch format) ---

export interface JsonPatchOp {
  op: PatchOperation;
  path: string;
  value?: PatchType;
}

export type Patch = JsonPatchOp[];

// --- ConversationPatch ---

export class ConversationPatch {
  static addNormalizedEntry(entryIndex: number, entry: NormalizedEntry): Patch {
    return [{
      op: 'add',
      path: `/entries/${entryIndex}`,
      value: { type: 'NORMALIZED_ENTRY', content: entry },
    }];
  }

  static addStdout(entryIndex: number, entry: string): Patch {
    return [{
      op: 'add',
      path: `/entries/${entryIndex}`,
      value: { type: 'STDOUT', content: entry },
    }];
  }

  static addStderr(entryIndex: number, entry: string): Patch {
    return [{
      op: 'add',
      path: `/entries/${entryIndex}`,
      value: { type: 'STDERR', content: entry },
    }];
  }

  static addDiff(entryIndex: string, diff: Diff): Patch {
    return [{
      op: 'add',
      path: `/entries/${entryIndex}`,
      value: { type: 'DIFF', content: diff },
    }];
  }

  static replaceDiff(entryIndex: string, diff: Diff): Patch {
    return [{
      op: 'replace',
      path: `/entries/${entryIndex}`,
      value: { type: 'DIFF', content: diff },
    }];
  }

  static removeDiff(entryIndex: string): Patch {
    return [{
      op: 'remove',
      path: `/entries/${entryIndex}`,
    }];
  }

  static replace(entryIndex: number, entry: NormalizedEntry): Patch {
    return [{
      op: 'replace',
      path: `/entries/${entryIndex}`,
      value: { type: 'NORMALIZED_ENTRY', content: entry },
    }];
  }

  static remove(entryIndex: number): Patch {
    return [{
      op: 'remove',
      path: `/entries/${entryIndex}`,
    }];
  }
}

// --- Helper functions ---

export function extractNormalizedEntryFromPatch(patch: Patch): [number, NormalizedEntry] | undefined {
  for (let i = patch.length - 1; i >= 0; i--) {
    const op = patch[i];
    if (!op) continue;
    const match = op.path.match(/^\/entries\/(\d+)$/);
    if (!match?.[1]) continue;
    const entryIndex = parseInt(match[1], 10);
    if (op.value?.type === 'NORMALIZED_ENTRY') {
      return [entryIndex, op.value.content];
    }
  }
  return undefined;
}

export function upsertNormalizedEntry(
  pushPatch: (patch: Patch) => void,
  index: number,
  normalizedEntry: NormalizedEntry,
  isNew: boolean,
): void {
  if (isNew) {
    pushPatch(ConversationPatch.addNormalizedEntry(index, normalizedEntry));
  } else {
    pushPatch(ConversationPatch.replace(index, normalizedEntry));
  }
}

export function addNormalizedEntry(
  pushPatch: (patch: Patch) => void,
  indexProvider: EntryIndexProvider,
  normalizedEntry: NormalizedEntry,
): number {
  const index = indexProvider.next();
  upsertNormalizedEntry(pushPatch, index, normalizedEntry, true);
  return index;
}

export function replaceNormalizedEntry(
  pushPatch: (patch: Patch) => void,
  index: number,
  normalizedEntry: NormalizedEntry,
): void {
  upsertNormalizedEntry(pushPatch, index, normalizedEntry, false);
}

export function slashCommands(
  commands: SlashCommandDescription[],
  discovering: boolean,
  error: string | undefined,
): Patch {
  return [
    { op: 'replace', path: '/commands', value: commands as unknown as PatchType },
    { op: 'replace', path: '/discovering', value: discovering as unknown as PatchType },
    { op: 'replace', path: '/error', value: (error ?? null) as unknown as PatchType },
  ];
}
