/**
 * Executor log types and normalization
 * Translates: crates/executors/src/logs/mod.rs
 */

import type { ApprovalStatus } from '@runner/utils';

export * from './plain-text-processor.js';
export * from './stderr-processor.js';
export * from './utils/index.js';

// --- ToolResultValueType ---

export type ToolResultValueType =
  | { type: 'markdown' }
  | { type: 'json' };

// --- ToolResult ---

export interface ToolResult {
  type: ToolResultValueType;
  value: unknown;
}

export function markdownResult(markdown: string): ToolResult {
  return { type: { type: 'markdown' }, value: markdown };
}

export function jsonResult(value: unknown): ToolResult {
  return { type: { type: 'json' }, value };
}

// --- CommandExitStatus ---

export type CommandExitStatus =
  | { type: 'exit_code'; code: number }
  | { type: 'success'; success: boolean };

// --- CommandRunResult ---

export interface CommandRunResult {
  exitStatus?: CommandExitStatus;
  output?: string;
}

// --- NormalizedConversation ---

export interface NormalizedConversation {
  entries: NormalizedEntry[];
  sessionId?: string;
  executorType: string;
  prompt?: string;
  summary?: string;
}

// --- NormalizedEntryError ---

export type NormalizedEntryError =
  | { type: 'setup_required' }
  | { type: 'other' };

// --- NormalizedEntryType ---

export type NormalizedEntryType =
  | { type: 'user_message' }
  | { type: 'user_feedback'; deniedTool: string }
  | { type: 'assistant_message' }
  | { type: 'tool_use'; toolName: string; actionType: ActionType; status: ToolStatus }
  | { type: 'system_message' }
  | { type: 'error_message'; errorType: NormalizedEntryError }
  | { type: 'thinking' }
  | { type: 'loading' }
  | { type: 'next_action'; failed: boolean; executionProcesses: number; needsSetup: boolean }
  | { type: 'token_usage_info'; info: TokenUsageInfo };

// --- TokenUsageInfo ---

export interface TokenUsageInfo {
  totalTokens: number;
  modelContextWindow: number;
}

// --- NormalizedEntry ---

export interface NormalizedEntry {
  timestamp?: string;
  entryType: NormalizedEntryType;
  content: string;
  metadata?: unknown;
}

export function withToolStatus(entry: NormalizedEntry, status: ToolStatus): NormalizedEntry | undefined {
  if (entry.entryType.type === 'tool_use') {
    return {
      ...entry,
      entryType: {
        ...entry.entryType,
        status,
      },
    };
  }
  return undefined;
}

// --- ToolStatus ---

export type ToolStatus =
  | { status: 'created' }
  | { status: 'success' }
  | { status: 'failed' }
  | { status: 'denied'; reason?: string }
  | { status: 'pending_approval'; approvalId: string; requestedAt: string; timeoutAt: string }
  | { status: 'timed_out' };

export function toolStatusFromApprovalStatus(approvalStatus: ApprovalStatus): ToolStatus | undefined {
  switch (approvalStatus.status) {
    case 'approved':
      return { status: 'created' };
    case 'denied':
      return { status: 'denied', reason: approvalStatus.reason };
    case 'timed_out':
      return { status: 'timed_out' };
    case 'pending':
      return undefined;
  }
}

// --- TodoItem ---

export interface TodoItem {
  content: string;
  status: string;
  priority?: string;
}

// --- ActionType ---

export type ActionType =
  | { action: 'file_read'; path: string }
  | { action: 'file_edit'; path: string; changes: FileChange[] }
  | { action: 'command_run'; command: string; result?: CommandRunResult }
  | { action: 'search'; query: string }
  | { action: 'web_fetch'; url: string }
  | { action: 'tool'; toolName: string; arguments?: unknown; result?: ToolResult }
  | { action: 'task_create'; description: string; subagentType?: string; result?: ToolResult }
  | { action: 'plan_presentation'; plan: string }
  | { action: 'todo_management'; todos: TodoItem[]; operation: string }
  | { action: 'other'; description: string };

// --- FileChange ---

export type FileChange =
  | { action: 'write'; content: string }
  | { action: 'delete' }
  | { action: 'rename'; newPath: string }
  | { action: 'edit'; unifiedDiff: string; hasLineNumbers: boolean };
