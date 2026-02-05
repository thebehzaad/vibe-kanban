/**
 * Base executor interface
 * Translates: crates/executors/src/lib.rs
 */

import type {
  ExecutorConfig,
  ExecutionRequest,
  ExecutionResult,
  ExecutorSession
} from './types.js';

export abstract class BaseExecutor {
  constructor(protected config: ExecutorConfig) {}

  abstract get name(): string;

  abstract execute(request: ExecutionRequest): Promise<ExecutionResult>;

  abstract createSession(): Promise<ExecutorSession>;

  abstract continueSession(
    sessionId: string,
    request: ExecutionRequest
  ): Promise<ExecutionResult>;

  abstract cancelExecution(sessionId: string): Promise<void>;
}
