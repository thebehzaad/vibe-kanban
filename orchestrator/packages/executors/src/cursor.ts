/**
 * Cursor executor
 * Translates: crates/executors/src/executors/cursor.rs
 */

import { BaseExecutor } from './base.js';
import { which, runCommand, type LogMsg, MsgStore } from '@orchestrator/utils';
import type {
  ExecutorConfig, ExecutionRequest, ExecutionResult, ExecutorSession,
  ExecutorType, NormalizeResult, SpawnedChild,
} from './types.js';

export interface CursorConfig extends ExecutorConfig {
  type: 'cursor';
  cursorPath?: string;
}

export class CursorExecutor extends BaseExecutor {
  private sessions = new Map<string, ExecutorSession>();
  constructor(config: CursorConfig) { super(config); }
  get name(): string { return 'Cursor'; }
  get type(): ExecutorType { return 'cursor'; }
  private get cursorConfig(): CursorConfig { return this.config as CursorConfig; }

  async resolveCommand(): Promise<{ command: string; args: string[] } | undefined> {
    const path = this.cursorConfig.cursorPath ?? which('cursor');
    return path ? { command: path, args: [] } : undefined;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const resolved = await this.resolveCommand();
    if (!resolved) return { success: false, output: '', error: 'Cursor CLI not found' };
    const result = await runCommand(resolved.command, ['--prompt', request.prompt], { cwd: request.workingDir });
    return { success: result.exitCode === 0, output: result.stdout, error: result.stderr || undefined, exitCode: result.exitCode };
  }

  async createSession(): Promise<ExecutorSession> {
    const session: ExecutorSession = { id: crypto.randomUUID(), executorType: 'cursor', messages: [], createdAt: new Date() };
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
