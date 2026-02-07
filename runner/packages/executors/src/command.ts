/**
 * Command building utilities
 * Translates: crates/executors/src/command.rs
 */

import { resolveExecutablePath } from '@runner/utils';

// --- Errors ---

export class CommandBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandBuildError';
  }

  static invalidBase(input: string): CommandBuildError {
    return new CommandBuildError(`base command cannot be parsed: ${input}`);
  }

  static emptyCommand(): CommandBuildError {
    return new CommandBuildError('base command is empty after parsing');
  }

  static invalidShellParams(detail: string): CommandBuildError {
    return new CommandBuildError(`invalid shell parameters: ${detail}`);
  }
}

// --- CommandParts ---

export class CommandParts {
  constructor(
    public readonly program: string,
    public readonly args: string[],
  ) {}

  async intoResolved(): Promise<{ executable: string; args: string[] }> {
    const executable = await resolveExecutablePath(this.program);
    if (!executable) {
      // Import ExecutorError lazily to avoid circular deps
      throw new Error(`Executable \`${this.program}\` not found in PATH`);
    }
    return { executable, args: this.args };
  }
}

// --- CmdOverrides ---

export interface CmdOverrides {
  baseCommandOverride?: string;
  additionalParams?: string[];
  env?: Record<string, string>;
}

// --- CommandBuilder ---

export class CommandBuilder {
  public base: string;
  public params: string[] | undefined;

  constructor(base: string) {
    this.base = base;
    this.params = undefined;
  }

  setParams(params: string[]): this {
    this.params = [...params];
    return this;
  }

  overrideBase(base: string): this {
    this.base = base;
    return this;
  }

  extendShellParams(more: string[]): this {
    const joined = more.join(' ').trim();
    if (!joined) return this;

    const extra = splitCommandLine(joined);
    if (this.params) {
      this.params.push(...extra);
    } else {
      this.params = extra;
    }
    return this;
  }

  extendParams(more: string[]): this {
    if (this.params) {
      this.params.push(...more);
    } else {
      this.params = [...more];
    }
    return this;
  }

  buildInitial(): CommandParts {
    return this._build([]);
  }

  buildFollowUp(additionalArgs: string[]): CommandParts {
    return this._build(additionalArgs);
  }

  private _build(additionalArgs: string[]): CommandParts {
    const parts: string[] = [];
    const baseParts = splitCommandLine(this.base);
    parts.push(...baseParts);
    if (this.params) {
      parts.push(...this.params);
    }
    parts.push(...additionalArgs);

    if (parts.length === 0) {
      throw CommandBuildError.emptyCommand();
    }

    const program = parts.shift()!;
    return new CommandParts(program, parts);
  }
}

// --- splitCommandLine ---

/**
 * Split a command line string into parts, respecting quotes.
 * On Windows uses simple split; on Unix uses shell-like parsing.
 */
function splitCommandLine(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    throw CommandBuildError.emptyCommand();
  }

  // Simple shell-like splitting that respects quotes
  const parts: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && !inSingle) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if ((char === ' ' || char === '\t') && !inSingle && !inDouble) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  if (inSingle || inDouble) {
    throw CommandBuildError.invalidBase(input);
  }

  if (parts.length === 0) {
    throw CommandBuildError.emptyCommand();
  }

  return parts;
}

// --- applyOverrides ---

export function applyOverrides(
  builder: CommandBuilder,
  overrides: CmdOverrides,
): CommandBuilder {
  if (overrides.baseCommandOverride) {
    builder.overrideBase(overrides.baseCommandOverride);
  }
  if (overrides.additionalParams) {
    builder.extendShellParams(overrides.additionalParams);
  }
  return builder;
}
