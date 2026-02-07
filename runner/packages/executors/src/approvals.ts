/**
 * Executor approval service
 * Translates: crates/executors/src/approvals.rs
 */

import type { ApprovalStatus } from '@runner/utils';

// --- Errors ---

export class ExecutorApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutorApprovalError';
  }

  static sessionNotRegistered(): ExecutorApprovalError {
    return new ExecutorApprovalError('executor approval session not registered');
  }

  static requestFailed(err: string): ExecutorApprovalError {
    return new ExecutorApprovalError(`executor approval request failed: ${err}`);
  }

  static serviceUnavailable(): ExecutorApprovalError {
    return new ExecutorApprovalError('executor approval service unavailable');
  }

  static cancelled(): ExecutorApprovalError {
    return new ExecutorApprovalError('executor approval request cancelled');
  }
}

// --- Trait (interface) ---

export interface ExecutorApprovalService {
  requestToolApproval(
    toolName: string,
    toolInput: unknown,
    toolCallId: string,
    cancel: AbortSignal,
  ): Promise<ApprovalStatus>;
}

// --- NoopExecutorApprovalService ---

export class NoopExecutorApprovalService implements ExecutorApprovalService {
  async requestToolApproval(
    _toolName: string,
    _toolInput: unknown,
    _toolCallId: string,
    _cancel: AbortSignal,
  ): Promise<ApprovalStatus> {
    return { status: 'approved' };
  }
}

// --- ToolCallMetadata ---

export interface ToolCallMetadata {
  toolCallId: string;
}
