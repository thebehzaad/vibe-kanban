/**
 * OpenAI Codex executor
 * Translates: crates/executors/src/executors/codex.rs
 */

import { BaseExecutor } from './base.js';
import type {
  ExecutorConfig,
  ExecutionRequest,
  ExecutionResult,
  ExecutorSession
} from './types.js';

export interface CodexConfig extends ExecutorConfig {
  type: 'codex';
  apiKey: string;
  model?: string;
}

export class CodexExecutor extends BaseExecutor {
  constructor(config: CodexConfig) {
    super(config);
  }

  get name(): string {
    return 'Codex';
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    // TODO: Implement OpenAI API integration
    throw new Error('Not implemented');
  }

  async createSession(): Promise<ExecutorSession> {
    return {
      id: crypto.randomUUID(),
      messages: [],
      createdAt: new Date()
    };
  }

  async continueSession(
    sessionId: string,
    request: ExecutionRequest
  ): Promise<ExecutionResult> {
    throw new Error('Not implemented');
  }

  async cancelExecution(sessionId: string): Promise<void> {
    throw new Error('Not implemented');
  }
}
