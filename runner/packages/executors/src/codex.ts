/**
 * OpenAI Codex executor
 * Translates: crates/executors/src/executors/codex.rs
 */

import { BaseExecutor } from './base.js';
import { which, runCommand, type LogMsg, MsgStore } from '@runner/utils';
import type {
  ExecutorConfig, ExecutionRequest, ExecutionResult, ExecutorSession,
  ExecutorType, NormalizeResult, SpawnedChild,
} from './types.js';

export interface CodexConfig extends ExecutorConfig {
  type: 'codex';
  apiKey?: string;
}

export class CodexExecutor extends BaseExecutor {
  private sessions = new Map<string, ExecutorSession>();
  constructor(config: CodexConfig) { super(config); }
  get name(): string { return 'Codex'; }
  get type(): ExecutorType { return 'codex'; }
  private get codexConfig(): CodexConfig { return this.config as CodexConfig; }

  async resolveCommand(): Promise<{ command: string; args: string[] } | undefined> {
    // Try to find codex in PATH
    const codexPath = which('codex');
    if (codexPath) {
      return { command: codexPath, args: [] };
    }

    // Try npx @openai/codex
    const npxPath = which('npx');
    if (npxPath) {
      return { command: npxPath, args: ['@openai/codex'] };
    }

    return undefined;
  }

  /** Build command-line arguments for codex */
  buildArgs(request: ExecutionRequest): string[] {
    const args: string[] = [];

    if (this.codexConfig.model) {
      args.push('--model', this.codexConfig.model);
    }

    if (this.codexConfig.autoApprove) {
      args.push('--full-auto');
    }

    args.push(request.prompt);

    return args;
  }

  /** Spawn Codex as a child process */
  async spawn(request: ExecutionRequest, msgStore: MsgStore): Promise<SpawnedChild | undefined> {
    const resolved = await this.resolveCommand();
    if (!resolved) return undefined;

    const args = [...resolved.args, ...this.buildArgs(request)];

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (this.codexConfig.apiKey) {
      env.OPENAI_API_KEY = this.codexConfig.apiKey;
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
      return { success: false, output: '', error: 'Codex CLI not found' };
    }

    const args = [...resolved.args, ...this.buildArgs(request)];

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (this.codexConfig.apiKey) {
      env.OPENAI_API_KEY = this.codexConfig.apiKey;
    }
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
      executorType: 'codex',
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
