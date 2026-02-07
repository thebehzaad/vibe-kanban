/**
 * Executor core types and interfaces
 * Translates: crates/executors/src/executors/mod.rs
 */

import type { ChildProcess } from 'node:child_process';
import type { MsgStore } from '@runner/utils';
import type { ExecutorApprovalService } from '../approvals.js';
import type { CommandBuildError } from '../command.js';
import type { ExecutionEnv } from '../env.js';
import type { McpConfig } from '../mcp-config.js';

// --- Re-export submodules (matches pub mod declarations in Rust) ---
export * as claude from './claude.js';
export * as amp from './amp.js';
export * as codex from './codex.js';
export * as copilot from './copilot.js';
export * as cursor from './cursor.js';
export * as droid from './droid.js';
export * as gemini from './gemini.js';
export * as opencode from './opencode.js';
export * as qwen from './qwen.js';
export * as utils from './utils.js';

// --- SlashCommandDescription ---

export interface SlashCommandDescription {
  name: string;
  description?: string;
}

// --- BaseAgentCapability ---

export type BaseAgentCapability =
  | 'SESSION_FORK'
  | 'SETUP_HELPER'
  | 'CONTEXT_USAGE';

// --- ExecutorError ---

export class ExecutorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutorError';
  }

  static followUpNotSupported(reason: string): ExecutorError {
    return new ExecutorError(`Follow-up is not supported: ${reason}`);
  }

  static unknownExecutorType(typ: string): ExecutorError {
    return new ExecutorError(`Unknown executor type: ${typ}`);
  }

  static io(err: Error): ExecutorError {
    const e = new ExecutorError(`I/O error: ${err.message}`);
    e.cause = err;
    return e;
  }

  static executableNotFound(program: string): ExecutorError {
    return new ExecutorError(`Executable \`${program}\` not found in PATH`);
  }

  static setupHelperNotSupported(): ExecutorError {
    return new ExecutorError('Setup helper not supported');
  }

  static authRequired(reason: string): ExecutorError {
    return new ExecutorError(`Auth required: ${reason}`);
  }
}

// --- BaseCodingAgent (discriminant enum) ---

export type BaseCodingAgent =
  | 'CLAUDE_CODE'
  | 'AMP'
  | 'GEMINI'
  | 'CODEX'
  | 'OPENCODE'
  | 'CURSOR_AGENT'
  | 'QWEN_CODE'
  | 'COPILOT'
  | 'DROID';

// --- CodingAgent (tagged union - matches enum_dispatch) ---

export type CodingAgent =
  | { type: 'CLAUDE_CODE'; config: CodingAgentConfig }
  | { type: 'AMP'; config: CodingAgentConfig }
  | { type: 'GEMINI'; config: CodingAgentConfig }
  | { type: 'CODEX'; config: CodingAgentConfig }
  | { type: 'OPENCODE'; config: CodingAgentConfig }
  | { type: 'CURSOR_AGENT'; config: CodingAgentConfig }
  | { type: 'QWEN_CODE'; config: CodingAgentConfig }
  | { type: 'COPILOT'; config: CodingAgentConfig }
  | { type: 'DROID'; config: CodingAgentConfig };

export interface CodingAgentConfig {
  appendPrompt?: AppendPrompt;
  [key: string]: unknown;
}

export function codingAgentToBase(agent: CodingAgent): BaseCodingAgent {
  return agent.type;
}

export function codingAgentCapabilities(agent: CodingAgent): BaseAgentCapability[] {
  switch (agent.type) {
    case 'CLAUDE_CODE':
      return ['SESSION_FORK', 'CONTEXT_USAGE'];
    case 'OPENCODE':
      return ['SESSION_FORK', 'CONTEXT_USAGE'];
    case 'CODEX':
      return ['SESSION_FORK', 'SETUP_HELPER', 'CONTEXT_USAGE'];
    case 'AMP':
    case 'GEMINI':
    case 'QWEN_CODE':
    case 'DROID':
      return ['SESSION_FORK'];
    case 'CURSOR_AGENT':
      return ['SETUP_HELPER'];
    case 'COPILOT':
      return [];
  }
}

export function codingAgentSupportsMcp(agent: CodingAgent): boolean {
  return defaultMcpConfigPath(agent) !== undefined;
}

// --- AvailabilityInfo ---

export type AvailabilityInfo =
  | { type: 'LOGIN_DETECTED'; lastAuthTimestamp: number }
  | { type: 'INSTALLATION_FOUND' }
  | { type: 'NOT_FOUND' };

export function isAvailable(info: AvailabilityInfo): boolean {
  return info.type === 'LOGIN_DETECTED' || info.type === 'INSTALLATION_FOUND';
}

// --- StandardCodingAgentExecutor (trait → interface) ---

export interface StandardCodingAgentExecutor {
  useApprovals?(approvals: ExecutorApprovalService): void;

  availableSlashCommands?(workdir: string): Promise<SlashCommandDescription[]>;

  spawn(
    currentDir: string,
    prompt: string,
    env: ExecutionEnv,
  ): Promise<SpawnedChild>;

  spawnFollowUp(
    currentDir: string,
    prompt: string,
    sessionId: string,
    resetToMessageId: string | undefined,
    env: ExecutionEnv,
  ): Promise<SpawnedChild>;

  spawnReview?(
    currentDir: string,
    prompt: string,
    sessionId: string | undefined,
    env: ExecutionEnv,
  ): Promise<SpawnedChild>;

  normalizeLogs(rawLogsMsgStore: MsgStore, worktreePath: string): void;

  defaultMcpConfigPath?(): string | undefined;

  getSetupHelperAction?(): Promise<unknown>;

  getAvailabilityInfo?(): AvailabilityInfo;
}

// --- ExecutorExitResult ---

export type ExecutorExitResult = 'success' | 'failure';

// --- SpawnedChild ---

export interface SpawnedChild {
  child: ChildProcess;
  exitSignal?: Promise<ExecutorExitResult>;
  cancel?: AbortController;
}

// --- AppendPrompt ---

export class AppendPrompt {
  constructor(public readonly value?: string) {}

  get(): string | undefined {
    return this.value;
  }

  combinePrompt(prompt: string): string {
    if (this.value) {
      return `${prompt}${this.value}`;
    }
    return prompt;
  }
}

// --- buildReviewPrompt ---

import type { RepoReviewContext } from '../actions/review.js';

export function buildReviewPrompt(
  context: RepoReviewContext[] | undefined,
  additionalPrompt: string | undefined,
): string {
  let prompt = 'Please review the code changes.\n\n';

  if (context) {
    for (const repo of context) {
      prompt += `Repository: ${repo.repoName}\n`;
      prompt += `Review all changes from base commit ${repo.baseCommit} to HEAD.\n`;
      prompt += `Use \`git diff ${repo.baseCommit}..HEAD\` to see the changes.\n`;
      prompt += '\n';
    }
  }

  if (additionalPrompt) {
    prompt += additionalPrompt;
  }

  return prompt;
}

// --- defaultMcpConfigPath helper ---

function defaultMcpConfigPath(_agent: CodingAgent): string | undefined {
  // Stub - each executor implementation provides its own config path
  return undefined;
}
