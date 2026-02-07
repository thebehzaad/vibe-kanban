/**
 * Executor types and interfaces
 * Translates: crates/executors/src/types.rs
 */

import type { ChildProcess } from 'node:child_process';
import type { NormalizedEntry, LogMsg, MsgStore } from '@runner/utils';

export type ExecutorType =
  | 'claude'
  | 'cursor'
  | 'codex'
  | 'gemini'
  | 'copilot'
  | 'qwen'
  | 'amp'
  | 'droid'
  | 'opencode';

export interface ExecutorConfig {
  type: ExecutorType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeout?: number;
  autoApprove?: boolean;
}

export interface ExecutionRequest {
  prompt: string;
  context?: string;
  files?: Record<string, string>;
  options?: Record<string, unknown>;
  workingDir?: string;
  env?: Record<string, string>;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  filesModified?: string[];
  tokensUsed?: number;
  exitCode?: number;
  sessionId?: string;
}

export interface ExecutorMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ExecutorSession {
  id: string;
  executorType: ExecutorType;
  messages: ExecutorMessage[];
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

/** A spawned child process from an executor */
export interface SpawnedChild {
  process: ChildProcess;
  pid: number;
  msgStore: MsgStore;
  abortController: AbortController;
}

/** Environment configuration for an execution */
export interface ExecutionEnv {
  repoPath: string;
  workingDir: string;
  branch: string;
  env: Record<string, string>;
  commitReminder?: string;
  permissions?: string[];
}

/** Action types that executors can perform */
export type ExecutorActionType =
  | 'coding_agent_initial'
  | 'coding_agent_follow_up'
  | 'review'
  | 'script';

/** Action descriptor for the executor to run */
export interface ExecutorAction {
  type: ExecutorActionType;
  prompt: string;
  sessionId?: string;
  messageUuid?: string;
  workingDir?: string;
  env?: Record<string, string>;
  scriptContext?: 'setup' | 'cleanup' | 'archive' | 'devserver';
}

/** Slash command available from an executor */
export interface SlashCommand {
  name: string;
  description: string;
  executor: ExecutorType;
}

/** Log normalization result */
export interface NormalizeResult {
  entries: NormalizedEntry[];
  sessionId?: string;
  lastMessageUuid?: string;
}

/** MCP server configuration */
export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Executor error */
export class ExecutorError extends Error {
  constructor(
    message: string,
    public readonly executorType: ExecutorType,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ExecutorError';
  }
}
