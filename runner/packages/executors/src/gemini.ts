/**
 * Google Gemini CLI executor
 * Translates: crates/executors/src/executors/gemini.rs
 */

import { BaseExecutor } from './base.js';
import { which, runCommand, type LogMsg, MsgStore } from '@runner/utils';
import type {
  ExecutorConfig, ExecutionRequest, ExecutionResult, ExecutorSession,
  ExecutorType, NormalizeResult, SpawnedChild,
} from './types.js';

export interface GeminiConfig extends ExecutorConfig {
  type: 'gemini';
  apiKey?: string;
  model?: string; // defaults to gemini-2.5-pro
}

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';

export class GeminiExecutor extends BaseExecutor {
  private sessions = new Map<string, ExecutorSession>();
  constructor(config: GeminiConfig) { super(config); }
  get name(): string { return 'Gemini'; }
  get type(): ExecutorType { return 'gemini'; }
  private get geminiConfig(): GeminiConfig { return this.config as GeminiConfig; }

  async resolveCommand(): Promise<{ command: string; args: string[] } | undefined> {
    const geminiPath = which('gemini');
    if (geminiPath) {
      return { command: geminiPath, args: [] };
    }

    return undefined;
  }

  /** Build command-line arguments for gemini */
  buildArgs(request: ExecutionRequest): string[] {
    const args: string[] = [];

    const model = this.geminiConfig.model ?? DEFAULT_GEMINI_MODEL;
    args.push('--model', model);

    args.push('--prompt', request.prompt);

    return args;
  }

  /** Spawn Gemini as a child process */
  async spawn(request: ExecutionRequest, msgStore: MsgStore): Promise<SpawnedChild | undefined> {
    const resolved = await this.resolveCommand();
    if (!resolved) return undefined;

    const args = [...resolved.args, ...this.buildArgs(request)];

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (this.geminiConfig.apiKey) {
      env.GEMINI_API_KEY = this.geminiConfig.apiKey;
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
      return { success: false, output: '', error: 'Gemini CLI not found' };
    }

    const args = [...resolved.args, ...this.buildArgs(request)];

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (this.geminiConfig.apiKey) {
      env.GEMINI_API_KEY = this.geminiConfig.apiKey;
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
      executorType: 'gemini',
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
