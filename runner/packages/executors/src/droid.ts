/**
 * Droid agent executor
 * Translates: crates/executors/src/executors/droid.rs
 *
 * Supports session forking via --fork flag for parallel execution.
 */

import { BaseExecutor } from './base.js';
import { which, runCommand, type LogMsg, MsgStore } from '@runner/utils';
import type {
  ExecutorConfig, ExecutionRequest, ExecutionResult, ExecutorSession,
  ExecutorType, NormalizeResult, SpawnedChild,
} from './types.js';

export interface DroidConfig extends ExecutorConfig {
  type: 'droid';
}

export class DroidExecutor extends BaseExecutor {
  private sessions = new Map<string, ExecutorSession>();
  constructor(config: DroidConfig) { super(config); }
  get name(): string { return 'Droid'; }
  get type(): ExecutorType { return 'droid'; }
  private get droidConfig(): DroidConfig { return this.config as DroidConfig; }

  async resolveCommand(): Promise<{ command: string; args: string[] } | undefined> {
    const droidPath = which('droid');
    if (droidPath) {
      return { command: droidPath, args: [] };
    }

    return undefined;
  }

  /** Build command-line arguments for droid */
  buildArgs(request: ExecutionRequest, sessionId?: string, fork?: boolean): string[] {
    const args: string[] = [];

    if (this.droidConfig.model) {
      args.push('--model', this.droidConfig.model);
    }

    // Session resumption
    if (sessionId) {
      args.push('--session', sessionId);
    }

    // Session forking for parallel execution
    if (fork) {
      args.push('--fork');
    }

    args.push('--prompt', request.prompt);

    return args;
  }

  /** Spawn Droid as a child process */
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
    fork?: boolean,
  ): Promise<SpawnedChild | undefined> {
    const resolved = await this.resolveCommand();
    if (!resolved) return undefined;

    const args = [...resolved.args, ...this.buildArgs(request, sessionId, fork)];

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

  /** Fork a session for parallel execution */
  async forkSession(
    sessionId: string,
    request: ExecutionRequest,
    msgStore: MsgStore,
  ): Promise<SpawnedChild | undefined> {
    return this.spawnFollowUp(request, sessionId, msgStore, true);
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const resolved = await this.resolveCommand();
    if (!resolved) {
      return { success: false, output: '', error: 'Droid CLI not found' };
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
      executorType: 'droid',
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
