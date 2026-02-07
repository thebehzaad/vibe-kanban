/**
 * OpenCode executor
 * Translates: crates/executors/src/executors/opencode.rs
 *
 * Supports auto-approve mode and auto-compact mode.
 */

import { BaseExecutor } from './base.js';
import { which, runCommand, type LogMsg, MsgStore } from '@runner/utils';
import type {
  ExecutorConfig, ExecutionRequest, ExecutionResult, ExecutorSession,
  ExecutorType, NormalizeResult, SpawnedChild,
} from './types.js';

export interface OpenCodeConfig extends ExecutorConfig {
  type: 'opencode';
  /** Enable auto-approve mode (skip tool approval prompts) */
  autoApprove?: boolean;
  /** Enable auto-compact mode (automatically compact context when it grows large) */
  autoCompact?: boolean;
}

export class OpenCodeExecutor extends BaseExecutor {
  private sessions = new Map<string, ExecutorSession>();
  constructor(config: OpenCodeConfig) { super(config); }
  get name(): string { return 'OpenCode'; }
  get type(): ExecutorType { return 'opencode'; }
  private get openCodeConfig(): OpenCodeConfig { return this.config as OpenCodeConfig; }

  async resolveCommand(): Promise<{ command: string; args: string[] } | undefined> {
    const opencodePath = which('opencode');
    if (opencodePath) {
      return { command: opencodePath, args: [] };
    }

    return undefined;
  }

  /** Build command-line arguments for opencode */
  buildArgs(request: ExecutionRequest, sessionId?: string): string[] {
    const args: string[] = [];

    if (this.openCodeConfig.model) {
      args.push('--model', this.openCodeConfig.model);
    }

    // Auto-approve mode skips tool approval prompts
    if (this.openCodeConfig.autoApprove) {
      args.push('--auto-approve');
    }

    // Auto-compact mode automatically compacts context
    if (this.openCodeConfig.autoCompact) {
      args.push('--auto-compact');
    }

    // Session resumption
    if (sessionId) {
      args.push('--session', sessionId);
    }

    args.push('--prompt', request.prompt);

    return args;
  }

  /** Spawn OpenCode as a child process */
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

  /** Spawn a follow-up with session resumption */
  async spawnFollowUp(
    request: ExecutionRequest,
    sessionId: string,
    msgStore: MsgStore,
  ): Promise<SpawnedChild | undefined> {
    const resolved = await this.resolveCommand();
    if (!resolved) return undefined;

    const args = [...resolved.args, ...this.buildArgs(request, sessionId)];

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
      return { success: false, output: '', error: 'OpenCode CLI not found' };
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
      executorType: 'opencode',
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
}
