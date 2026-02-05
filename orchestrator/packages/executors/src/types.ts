/**
 * Executor types and interfaces
 */

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
}

export interface ExecutionRequest {
  prompt: string;
  context?: string;
  files?: Record<string, string>;
  options?: Record<string, unknown>;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  filesModified?: string[];
  tokensUsed?: number;
}

export interface ExecutorMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ExecutorSession {
  id: string;
  messages: ExecutorMessage[];
  createdAt: Date;
}
