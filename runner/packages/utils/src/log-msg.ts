/**
 * Log message types for streaming executor output
 * Translates: crates/utils/src/log_msg.rs
 */

// Event name constants
export const EV_STDOUT = 'stdout';
export const EV_STDERR = 'stderr';
export const EV_JSON_PATCH = 'json_patch';
export const EV_SESSION_ID = 'session_id';
export const EV_MESSAGE_ID = 'message_id';
export const EV_READY = 'ready';
export const EV_FINISHED = 'finished';

/**
 * Discriminated union matching Rust enum:
 *   enum LogMsg { Stdout(String), Stderr(String), JsonPatch(Patch), SessionId(String), MessageId(String), Ready, Finished }
 */
export type LogMsg =
  | { Stdout: string }
  | { Stderr: string }
  | { JsonPatch: unknown }
  | { SessionId: string }
  | { MessageId: string }
  | { Ready: true }
  | { Finished: true };

// -- Type guards --

export function isStdout(msg: LogMsg): msg is { Stdout: string } {
  return 'Stdout' in msg;
}

export function isStderr(msg: LogMsg): msg is { Stderr: string } {
  return 'Stderr' in msg;
}

export function isJsonPatch(msg: LogMsg): msg is { JsonPatch: unknown } {
  return 'JsonPatch' in msg;
}

export function isSessionId(msg: LogMsg): msg is { SessionId: string } {
  return 'SessionId' in msg;
}

export function isMessageId(msg: LogMsg): msg is { MessageId: string } {
  return 'MessageId' in msg;
}

export function isReady(msg: LogMsg): msg is { Ready: true } {
  return 'Ready' in msg;
}

export function isFinished(msg: LogMsg): msg is { Finished: true } {
  return 'Finished' in msg;
}

// -- Methods as functions (matching Rust impl LogMsg) --

/** Get the event name for this message. Matches Rust LogMsg::name() */
export function logMsgName(msg: LogMsg): string {
  if (isStdout(msg)) return EV_STDOUT;
  if (isStderr(msg)) return EV_STDERR;
  if (isJsonPatch(msg)) return EV_JSON_PATCH;
  if (isSessionId(msg)) return EV_SESSION_ID;
  if (isMessageId(msg)) return EV_MESSAGE_ID;
  if (isReady(msg)) return EV_READY;
  if (isFinished(msg)) return EV_FINISHED;
  return EV_STDOUT;
}

/** Convert to SSE event format. Matches Rust LogMsg::to_sse_event() */
export function logMsgToSseEvent(msg: LogMsg): { event: string; data: string } {
  const event = logMsgName(msg);
  if (isStdout(msg)) return { event, data: msg.Stdout };
  if (isStderr(msg)) return { event, data: msg.Stderr };
  if (isJsonPatch(msg)) return { event, data: JSON.stringify(msg.JsonPatch) };
  if (isSessionId(msg)) return { event, data: msg.SessionId };
  if (isMessageId(msg)) return { event, data: msg.MessageId };
  return { event, data: '' };
}

/** Convert to WebSocket message string. Matches Rust LogMsg::to_ws_message() */
export function logMsgToWsMessage(msg: LogMsg): string {
  return JSON.stringify(msg);
}

/** Approximate byte size for history budgeting. Matches Rust LogMsg::approx_bytes() */
export function logMsgApproxBytes(msg: LogMsg): number {
  const OVERHEAD = 8;
  if (isStdout(msg)) return EV_STDOUT.length + msg.Stdout.length + OVERHEAD;
  if (isStderr(msg)) return EV_STDERR.length + msg.Stderr.length + OVERHEAD;
  if (isJsonPatch(msg)) {
    const jsonLen = JSON.stringify(msg.JsonPatch).length;
    return EV_JSON_PATCH.length + jsonLen + OVERHEAD;
  }
  if (isSessionId(msg)) return EV_SESSION_ID.length + msg.SessionId.length + OVERHEAD;
  if (isMessageId(msg)) return EV_MESSAGE_ID.length + msg.MessageId.length + OVERHEAD;
  if (isReady(msg)) return EV_READY.length + OVERHEAD;
  if (isFinished(msg)) return EV_FINISHED.length + OVERHEAD;
  return OVERHEAD;
}

// -- Factory functions --

/** Create a Stdout log message */
export function stdoutMsg(content: string): LogMsg {
  return { Stdout: content };
}

/** Create a Stderr log message */
export function stderrMsg(content: string): LogMsg {
  return { Stderr: content };
}

/** Create a JsonPatch log message */
export function jsonPatchMsg(patch: unknown): LogMsg {
  return { JsonPatch: patch };
}

/** Create a SessionId log message */
export function sessionIdMsg(id: string): LogMsg {
  return { SessionId: id };
}

/** Create a MessageId log message */
export function messageIdMsg(id: string): LogMsg {
  return { MessageId: id };
}

/** Create a Ready log message */
export function readyMsg(): LogMsg {
  return { Ready: true };
}

/** Create a Finished log message */
export function finishedMsg(): LogMsg {
  return { Finished: true };
}
