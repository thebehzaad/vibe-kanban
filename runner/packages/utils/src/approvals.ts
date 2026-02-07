/**
 * Approval utilities
 * Translates: crates/utils/src/approvals.rs
 */

import { randomUUID } from 'node:crypto';

export const APPROVAL_TIMEOUT_SECONDS = 36000; // 10 hours

export interface ApprovalRequest {
  id: string;
  toolName: string;
  toolInput: unknown;
  toolCallId: string;
  executionProcessId: string;
  createdAt: string;
  timeoutAt: string;
}

export interface CreateApprovalRequest {
  toolName: string;
  toolInput: unknown;
  toolCallId: string;
}

/** Tagged union matching Rust: #[serde(tag = "status", rename_all = "snake_case")] */
export type ApprovalStatus =
  | { status: 'pending' }
  | { status: 'approved' }
  | { status: 'denied'; reason?: string }
  | { status: 'timed_out' };

export interface ApprovalResponse {
  executionProcessId: string;
  status: ApprovalStatus;
}

/** Matches Rust: ApprovalRequest::from_create() */
export function createApprovalRequest(
  request: CreateApprovalRequest,
  executionProcessId: string,
): ApprovalRequest {
  const now = new Date();
  const timeoutAt = new Date(now.getTime() + APPROVAL_TIMEOUT_SECONDS * 1000);
  return {
    id: randomUUID(),
    toolName: request.toolName,
    toolInput: request.toolInput,
    toolCallId: request.toolCallId,
    executionProcessId,
    createdAt: now.toISOString(),
    timeoutAt: timeoutAt.toISOString(),
  };
}
