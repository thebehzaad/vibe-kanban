/**
 * Google Gemini executor
 * Translates: crates/executors/src/executors/gemini.rs
 */

import { BaseExecutor } from './base.js';
import type {
  ExecutorConfig,
  ExecutionRequest,
  ExecutionResult,
  ExecutorSession
} from './types.js';

export interface GeminiConfig extends ExecutorConfig {
  type: 'gemini';
  apiKey: string;
  model?: string; // defaults to gemini-pro
}

export class GeminiExecutor extends BaseExecutor {
  constructor(config: GeminiConfig) {
    super(config);
  }

  get name(): string {
    return 'Gemini';
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    // TODO: Implement Google Gemini API integration
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
