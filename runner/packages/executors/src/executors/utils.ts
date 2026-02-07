/**
 * Executor utilities
 * Translates: crates/executors/src/executors/utils.rs
 */

import type { BaseCodingAgent, SlashCommandDescription } from './index.js';

// --- SlashCommandCall ---

export interface SlashCommandCall {
  name: string;
  arguments: string;
}

/**
 * Parse a slash command from a prompt string.
 * Returns the parsed command or undefined if not a slash command.
 */
export function parseSlashCommand(prompt: string): SlashCommandCall | undefined {
  const trimmed = prompt.trimStart();
  if (!trimmed.startsWith('/')) return undefined;

  const withoutSlash = trimmed.slice(1);
  const spaceIdx = withoutSlash.search(/\s/);

  let name: string;
  let args: string;

  if (spaceIdx === -1) {
    name = withoutSlash.trim().toLowerCase();
    args = '';
  } else {
    name = withoutSlash.slice(0, spaceIdx).trim().toLowerCase();
    args = withoutSlash.slice(spaceIdx + 1).trim();
  }

  if (!name) return undefined;

  return { name, arguments: args };
}

// --- Slash command reordering ---

export function reorderSlashCommands(
  commands: SlashCommandDescription[],
): SlashCommandDescription[] {
  let compactCommand: SlashCommandDescription | undefined;
  let reviewCommand: SlashCommandDescription | undefined;
  const remaining: SlashCommandDescription[] = [];

  for (const command of commands) {
    switch (command.name) {
      case 'compact':
        compactCommand = command;
        break;
      case 'review':
        reviewCommand = command;
        break;
      default:
        remaining.push(command);
    }
  }

  const result: SlashCommandDescription[] = [];
  if (compactCommand) result.push(compactCommand);
  if (reviewCommand) result.push(reviewCommand);
  result.push(...remaining);
  return result;
}

// --- Slash command cache ---

const SLASH_COMMANDS_CACHE_CAPACITY = 32;
const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface SlashCommandCacheKey {
  path: string;
  executorId: string;
}

interface CachedEntry {
  cachedAt: number;
  commands: SlashCommandDescription[];
}

export class SlashCommandCache {
  private static instance: SlashCommandCache;
  private cache = new Map<string, CachedEntry>();

  static getInstance(): SlashCommandCache {
    if (!SlashCommandCache.instance) {
      SlashCommandCache.instance = new SlashCommandCache();
    }
    return SlashCommandCache.instance;
  }

  private makeKey(key: SlashCommandCacheKey): string {
    return `${key.path}::${key.executorId}`;
  }

  get(key: SlashCommandCacheKey): SlashCommandDescription[] | undefined {
    const entry = this.cache.get(this.makeKey(key));
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > TTL_MS) {
      this.cache.delete(this.makeKey(key));
      return undefined;
    }
    return entry.commands;
  }

  put(key: SlashCommandCacheKey, commands: SlashCommandDescription[]): void {
    // Evict oldest if at capacity
    if (this.cache.size >= SLASH_COMMANDS_CACHE_CAPACITY) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(this.makeKey(key), {
      cachedAt: Date.now(),
      commands,
    });
  }
}
