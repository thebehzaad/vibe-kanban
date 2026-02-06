/**
 * Claude Code executor - Full implementation
 * Translates: crates/executors/src/executors/claude.rs
 */

import { BaseExecutor } from './base.js';
import {
  MsgStore,
  which,
  runCommand,
  type NormalizedEntry,
  type LogMsg,
} from '@orchestrator/utils';
import type {
  ExecutorConfig,
  ExecutionRequest,
  ExecutionResult,
  ExecutorSession,
  ExecutorType,
  NormalizeResult,
  SlashCommand,
  SpawnedChild,
} from './types.js';

export interface ClaudeConfig extends ExecutorConfig {
  type: 'claude';
  apiKey?: string;
  model?: string;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  permissionMode?: 'default' | 'plan' | 'bypassPermissions';
}

export class ClaudeExecutor extends BaseExecutor {
  private sessions = new Map<string, ExecutorSession>();

  constructor(config: ClaudeConfig) {
    super(config);
  }

  get name(): string { return 'Claude Code'; }
  get type(): ExecutorType { return 'claude'; }

  private get claudeConfig(): ClaudeConfig {
    return this.config as ClaudeConfig;
  }

  /** Resolve the claude command path */
  async resolveCommand(): Promise<{ command: string; args: string[] } | undefined> {
    // Try to find claude or claude-code in PATH
    const claudePath = which('claude') ?? which('claude-code');
    if (claudePath) {
      return { command: claudePath, args: [] };
    }

    // Try npx
    const npxPath = which('npx');
    if (npxPath) {
      return { command: npxPath, args: ['@anthropic-ai/claude-code'] };
    }

    return undefined;
  }

  /** Build command-line arguments for claude */
  buildArgs(request: ExecutionRequest, sessionId?: string, messageUuid?: string): string[] {
    const args: string[] = ['--print', '--output-format', 'stream-json'];

    if (this.claudeConfig.model) {
      args.push('--model', this.claudeConfig.model);
    }

    if (this.claudeConfig.maxTurns) {
      args.push('--max-turns', String(this.claudeConfig.maxTurns));
    }

    if (this.claudeConfig.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions');
    }

    if (this.claudeConfig.allowedTools?.length) {
      for (const tool of this.claudeConfig.allowedTools) {
        args.push('--allowedTools', tool);
      }
    }

    if (this.claudeConfig.disallowedTools?.length) {
      for (const tool of this.claudeConfig.disallowedTools) {
        args.push('--disallowedTools', tool);
      }
    }

    // Session resumption
    if (sessionId) {
      args.push('--resume', sessionId);
      if (messageUuid) {
        args.push('--continue');
      }
    }

    // Prompt
    args.push('--prompt', request.prompt);

    return args;
  }

  /** Spawn Claude as a child process */
  async spawn(request: ExecutionRequest, msgStore: MsgStore): Promise<SpawnedChild | undefined> {
    const resolved = await this.resolveCommand();
    if (!resolved) return undefined;

    const args = [...resolved.args, ...this.buildArgs(request)];

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (this.claudeConfig.apiKey) {
      env.ANTHROPIC_API_KEY = this.claudeConfig.apiKey;
    }
    if (request.env) {
      Object.assign(env, request.env);
    }

    return this.spawnProcess(resolved.command, args, {
      msgStore,
      cwd: request.workingDir,
      env,
    });
  }

  /** Spawn a follow-up with session resumption */
  async spawnFollowUp(
    request: ExecutionRequest,
    sessionId: string,
    msgStore: MsgStore,
    messageUuid?: string
  ): Promise<SpawnedChild | undefined> {
    const resolved = await this.resolveCommand();
    if (!resolved) return undefined;

    const args = [...resolved.args, ...this.buildArgs(request, sessionId, messageUuid)];

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (this.claudeConfig.apiKey) {
      env.ANTHROPIC_API_KEY = this.claudeConfig.apiKey;
    }
    if (request.env) {
      Object.assign(env, request.env);
    }

    return this.spawnProcess(resolved.command, args, {
      msgStore,
      cwd: request.workingDir,
      env,
    });
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const resolved = await this.resolveCommand();
    if (!resolved) {
      return { success: false, output: '', error: 'Claude CLI not found' };
    }

    const args = [...resolved.args, ...this.buildArgs(request)];

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (this.claudeConfig.apiKey) {
      env.ANTHROPIC_API_KEY = this.claudeConfig.apiKey;
    }

    const result = await runCommand(resolved.command, args, {
      cwd: request.workingDir,
      env,
    });

    return {
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.stderr || undefined,
      exitCode: result.exitCode,
    };
  }

  async createSession(): Promise<ExecutorSession> {
    const session: ExecutorSession = {
      id: crypto.randomUUID(),
      executorType: 'claude',
      messages: [],
      createdAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async continueSession(sessionId: string, request: ExecutionRequest): Promise<ExecutionResult> {
    return this.execute({ ...request, options: { ...request.options, sessionId } });
  }

  async cancelExecution(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  /** Normalize Claude's JSON streaming output */
  normalizeLogs(rawLogs: LogMsg[]): NormalizeResult {
    const entries: NormalizedEntry[] = [];
    let sessionId: string | undefined;
    let lastMessageUuid: string | undefined;

    for (const log of rawLogs) {
      if (log.type === 'stdout') {
        // Claude outputs JSON lines in stream-json format
        for (const line of log.content.split('\n').filter(Boolean)) {
          try {
            const parsed = JSON.parse(line);
            const entry = this.parseClaudeJsonEntry(parsed, entries.length);
            if (entry) {
              entries.push(entry);
              if (entry.sessionId) sessionId = entry.sessionId;
              if (entry.messageUuid) lastMessageUuid = entry.messageUuid;
            }
          } catch {
            // Not JSON, treat as plain text
            entries.push({
              index: entries.length,
              type: 'assistant_message',
              content: line,
              timestamp: log.timestamp,
            });
          }
        }
      } else if (log.type === 'stderr') {
        entries.push({
          index: entries.length,
          type: 'error',
          content: log.content,
          timestamp: log.timestamp,
        });
      }
    }

    return { entries, sessionId, lastMessageUuid };
  }

  private parseClaudeJsonEntry(parsed: Record<string, unknown>, index: number): NormalizedEntry | null {
    const type = parsed.type as string;
    const timestamp = new Date();

    switch (type) {
      case 'system':
        return {
          index,
          type: 'system',
          content: (parsed.message as string) ?? '',
          timestamp,
          sessionId: parsed.session_id as string | undefined,
        };
      case 'assistant':
        return {
          index,
          type: 'assistant_message',
          content: (parsed.message as string) ?? JSON.stringify(parsed.content ?? ''),
          timestamp,
          messageUuid: parsed.message_id as string | undefined,
        };
      case 'user':
        return {
          index,
          type: 'user_message',
          content: (parsed.message as string) ?? '',
          timestamp,
        };
      case 'tool_use':
        return {
          index,
          type: 'tool_call',
          content: JSON.stringify({ name: parsed.name, input: parsed.input }),
          timestamp,
          metadata: { toolName: parsed.name },
        };
      case 'tool_result':
        return {
          index,
          type: 'tool_result',
          content: (parsed.output as string) ?? JSON.stringify(parsed.content ?? ''),
          timestamp,
        };
      case 'result':
        return {
          index,
          type: 'assistant_message',
          content: (parsed.result as string) ?? '',
          timestamp,
          sessionId: parsed.session_id as string | undefined,
        };
      default:
        return null;
    }
  }

  async availableSlashCommands(): Promise<SlashCommand[]> {
    return [
      { name: '/compact', description: 'Compact conversation context', executor: 'claude' },
      { name: '/clear', description: 'Clear conversation history', executor: 'claude' },
      { name: '/cost', description: 'Show token usage costs', executor: 'claude' },
      { name: '/doctor', description: 'Check system health', executor: 'claude' },
      { name: '/help', description: 'Show available commands', executor: 'claude' },
      { name: '/init', description: 'Initialize project configuration', executor: 'claude' },
      { name: '/review', description: 'Request code review', executor: 'claude' },
    ];
  }
}
