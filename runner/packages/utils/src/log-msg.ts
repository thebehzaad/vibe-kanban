/**
 * Log message types for streaming executor output
 * Translates: crates/utils/src/log_msg.rs
 */

/** Raw log message types from executor process */
export type LogMsgType = 'stdout' | 'stderr' | 'json_patch' | 'finished' | 'system';

/** A log message from an executor process */
export interface LogMsg {
  type: LogMsgType;
  content: string;
  timestamp: Date;
}

/** Normalized log entry types */
export type NormalizedEntryType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'file_edit'
  | 'file_create'
  | 'file_delete'
  | 'command_execution'
  | 'command_output'
  | 'approval_request'
  | 'approval_response'
  | 'error'
  | 'thinking'
  | 'system'
  | 'progress';

/** A normalized log entry parsed from raw output */
export interface NormalizedEntry {
  index: number;
  type: NormalizedEntryType;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  /** UUID of the message (for session resumption) */
  messageUuid?: string;
  /** Session ID extracted from the log */
  sessionId?: string;
}

/** Create a stdout log message */
export function stdoutMsg(content: string): LogMsg {
  return { type: 'stdout', content, timestamp: new Date() };
}

/** Create a stderr log message */
export function stderrMsg(content: string): LogMsg {
  return { type: 'stderr', content, timestamp: new Date() };
}

/** Create a JSON patch log message */
export function jsonPatchMsg(content: string): LogMsg {
  return { type: 'json_patch', content, timestamp: new Date() };
}

/** Create a finished log message */
export function finishedMsg(exitCode: number): LogMsg {
  return {
    type: 'finished',
    content: JSON.stringify({ exitCode }),
    timestamp: new Date(),
  };
}

/** Create a system log message */
export function systemMsg(content: string): LogMsg {
  return { type: 'system', content, timestamp: new Date() };
}

/** Convert a LogMsg to a WebSocket-friendly format */
export function logMsgToWs(msg: LogMsg): string {
  return JSON.stringify({
    type: msg.type,
    content: msg.content,
    timestamp: msg.timestamp.toISOString(),
  });
}

/** Parse a WebSocket message back to a LogMsg */
export function wsToLogMsg(data: string): LogMsg | null {
  try {
    const parsed = JSON.parse(data);
    return {
      type: parsed.type,
      content: parsed.content,
      timestamp: new Date(parsed.timestamp),
    };
  } catch {
    return null;
  }
}

/** Extract exit code from a finished message */
export function getExitCode(msg: LogMsg): number | null {
  if (msg.type !== 'finished') return null;
  try {
    const parsed = JSON.parse(msg.content);
    return typeof parsed.exitCode === 'number' ? parsed.exitCode : null;
  } catch {
    return null;
  }
}
