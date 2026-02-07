/**
 * Qwen Code executor
 * Translates: crates/executors/src/executors/qwen.rs
 */

import { BaseExecutor } from './base.js';
import { which, runCommand, type LogMsg, MsgStore } from '@runner/utils';
import type {
  ExecutorConfig, ExecutionRequest, ExecutionResult, ExecutorSession,
  ExecutorType, NormalizeResult, SpawnedChild,
} from './types.js';

export interface QwenConfig extends ExecutorConfig {
  type: 'qwen';
  model?: string;
}

export class QwenExecutor extends BaseExecutor {
  private sessions = new Map<string, ExecutorSession>();
  constructor(config: QwenConfig) { super(config); }
  get name(): string { return 'Qwen Code'; }
  get type(): ExecutorType { return 'qwen'; }
  private get qwenConfig(): QwenConfig { return this.config as QwenConfig; }

  async resolveCommand(): Promise<{ command: string; args: string[] } | undefined> {
    const qwenPath = which('qwen-code');
    if (qwenPath) {
      return { command: qwenPath, args: [] };
    }

    return undefined;
  }

  /** Build command-line arguments for qwen-code */
  buildArgs(request: ExecutionRequest): string[] {
    const args: string[] = [];

    if (this.qwenConfig.model) {
      args.push('--model', this.qwenConfig.model);
    }

    args.push('--prompt', request.prompt);

    return args;
  }

  /** Spawn Qwen Code as a child process */
  async spawn(request: ExecutionRequest, msgStore: MsgStore): Promise<SpawnedChild | undefined> {
    const resolved = await this.resolveCommand();
    if (!resolved) return undefined;

    const args = [...resolved.args, ...this.buildArgs(request)];

    const env: Record<string, string> = { ...process.env as Record<string, string> };
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
      return { success: false, output: '', error: 'Qwen Code CLI not found' };
    }

    const args = [...resolved.args, ...this.buildArgs(request)];

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (request.env) {
      Object.assign(env, request.env);
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
      executorType: 'qwen',
      messages: [],
      createdAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async continueSession(sessionId: string, request: ExecutionRequest): Promise<ExecutionResult> {
    return this.execute(request);
  }

  async cancelExecution(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
