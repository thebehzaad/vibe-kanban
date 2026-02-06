/**
 * Base executor interface
 * Translates: crates/executors/src/lib.rs
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import {
  MsgStore,
  stdoutMsg,
  stderrMsg,
  finishedMsg,
  type NormalizedEntry,
  type LogMsg,
  runCommand,
  which,
} from '@orchestrator/utils';
import type {
  ExecutorConfig,
  ExecutionRequest,
  ExecutionResult,
  ExecutorSession,
  SpawnedChild,
  ExecutorAction,
  NormalizeResult,
  SlashCommand,
  McpServerConfig,
  ExecutorType,
} from './types.js';

export abstract class BaseExecutor {
  constructor(protected config: ExecutorConfig) {}

  abstract get name(): string;
  abstract get type(): ExecutorType;

  /** Execute a one-shot request */
  abstract execute(request: ExecutionRequest): Promise<ExecutionResult>;

  /** Create a new session */
  abstract createSession(): Promise<ExecutorSession>;

  /** Continue an existing session */
  abstract continueSession(sessionId: string, request: ExecutionRequest): Promise<ExecutionResult>;

  /** Cancel a running execution */
  abstract cancelExecution(sessionId: string): Promise<void>;

  /** Spawn the executor as a child process */
  spawnProcess(
    command: string,
    args: string[],
    options: SpawnOptions & { msgStore: MsgStore }
  ): SpawnedChild {
    const abortController = new AbortController();
    const proc = spawn(command, args, {
      ...options,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: abortController.signal,
    });

    const msgStore = options.msgStore;

    proc.stdout?.on('data', (data: Buffer) => {
      msgStore.push(stdoutMsg(data.toString()));
    });

    proc.stderr?.on('data', (data: Buffer) => {
      msgStore.push(stderrMsg(data.toString()));
    });

    proc.on('close', (code) => {
      msgStore.push(finishedMsg(code ?? 1));
      msgStore.close();
    });

    return {
      process: proc,
      pid: proc.pid ?? 0,
      msgStore,
      abortController,
    };
  }

  /** Normalize raw logs into structured entries (override per executor) */
  normalizeLogs(rawLogs: LogMsg[]): NormalizeResult {
    const entries: NormalizedEntry[] = rawLogs.map((log, i) => ({
      index: i,
      type: log.type === 'stderr' ? 'error' : 'assistant_message',
      content: log.content,
      timestamp: log.timestamp,
    }));

    return { entries };
  }

  /** Discover available slash commands */
  async availableSlashCommands(): Promise<SlashCommand[]> {
    return [];
  }

  /** Get MCP server configurations */
  getMcpServers(): McpServerConfig[] {
    return [];
  }

  /** Build the command to invoke this executor */
  async resolveCommand(): Promise<{ command: string; args: string[] } | undefined> {
    return undefined;
  }

  /** Check if the executor binary is available */
  async isAvailable(): Promise<boolean> {
    const resolved = await this.resolveCommand();
    if (!resolved) return false;
    return which(resolved.command) !== undefined;
  }
}

/** Registry of all available executors */
export class ExecutorRegistry {
  private executors = new Map<ExecutorType, BaseExecutor>();

  register(executor: BaseExecutor): void {
    this.executors.set(executor.type, executor);
  }

  get(type: ExecutorType): BaseExecutor | undefined {
    return this.executors.get(type);
  }

  getAll(): BaseExecutor[] {
    return [...this.executors.values()];
  }

  getAvailableTypes(): ExecutorType[] {
    return [...this.executors.keys()];
  }
}
