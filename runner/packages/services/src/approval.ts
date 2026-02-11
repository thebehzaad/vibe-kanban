/**
 * Approval service
 * Translates: crates/services/src/services/approvals.rs
 *
 * In-memory approval tracking with timeout, msg store patching,
 * and task-status transitions.
 */

import type { DatabaseType } from '@runner/db';
import {
  ExecutionProcessRepository,
  TaskRepository,
  type TaskStatus,
} from '@runner/db';
import type {
  ApprovalRequest,
  ApprovalResponse,
  ApprovalStatus,
} from '@runner/utils';
import {
  type NormalizedEntry,
  type ToolStatus,
  withToolStatus,
  toolStatusFromApprovalStatus,
} from '@runner/executors';
import type { ToolCallMetadata } from '@runner/executors';
import {
  ConversationPatch,
  extractNormalizedEntryFromPatch,
  type Patch,
} from '@runner/executors';
import type { MsgStore } from '@runner/utils';
import { isJsonPatch } from '@runner/utils';

// ── Internal types ──

interface PendingApproval {
  entryIndex: number;
  entry: NormalizedEntry;
  executionProcessId: string;
  toolName: string;
  resolve: (status: ApprovalStatus) => void;
}

export interface ToolContext {
  toolName: string;
  executionProcessId: string;
}

// ── Error ──

export type ApprovalErrorCode =
  | 'not_found'
  | 'already_completed'
  | 'no_executor_session'
  | 'no_tool_use_entry'
  | 'custom'
  | 'database';

export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode;

  constructor(code: ApprovalErrorCode, message: string) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
  }

  static notFound(): ApprovalError {
    return new ApprovalError('not_found', 'approval request not found');
  }

  static alreadyCompleted(): ApprovalError {
    return new ApprovalError('already_completed', 'approval request already completed');
  }

  static noExecutorSession(sessionId: string): ApprovalError {
    return new ApprovalError('no_executor_session', `no executor session found for session_id: ${sessionId}`);
  }

  static noToolUseEntry(): ApprovalError {
    return new ApprovalError('no_tool_use_entry', 'corresponding tool use entry not found for approval request');
  }

  static custom(msg: string): ApprovalError {
    return new ApprovalError('custom', msg);
  }

  static database(err: Error): ApprovalError {
    return new ApprovalError('database', err.message);
  }
}

// ── Approvals ──

export class Approvals {
  private pending = new Map<string, PendingApproval>();
  private completed = new Map<string, ApprovalStatus>();
  private timeouts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private msgStores: Map<string, MsgStore>) {}

  createWithWaiter(
    request: ApprovalRequest,
  ): [ApprovalRequest, Promise<ApprovalStatus>] {
    let resolveApproval!: (status: ApprovalStatus) => void;
    const waiterPromise = new Promise<ApprovalStatus>((resolve) => {
      resolveApproval = resolve;
    });

    const reqId = request.id;
    const store = this.msgStores.get(request.executionProcessId);

    if (store) {
      // Find the matching tool use entry by tool call id
      const matching = findMatchingToolUse(store, request.toolCallId);

      if (matching) {
        const [idx, matchingEntry] = matching;

        const approvalEntry = withToolStatus(matchingEntry, {
          status: 'pending_approval',
          approvalId: reqId,
          requestedAt: request.createdAt,
          timeoutAt: request.timeoutAt,
        });

        if (!approvalEntry) {
          throw ApprovalError.noToolUseEntry();
        }

        store.push({ JsonPatch: ConversationPatch.replace(idx, approvalEntry) });

        this.pending.set(reqId, {
          entryIndex: idx,
          entry: matchingEntry,
          executionProcessId: request.executionProcessId,
          toolName: request.toolName,
          resolve: resolveApproval,
        });

        console.debug(
          `Created approval ${reqId} for tool '${request.toolName}' at entry index ${idx}`,
        );
      } else {
        console.warn(
          `No matching tool use entry found for approval request: tool='${request.toolName}', execution_process_id=${request.executionProcessId}`,
        );
      }
    } else {
      console.warn(
        `No msg_store found for execution_process_id: ${request.executionProcessId}`,
      );
    }

    this.spawnTimeoutWatcher(reqId, request.timeoutAt, waiterPromise);
    return [request, waiterPromise];
  }

  respond(
    db: DatabaseType,
    id: string,
    req: ApprovalResponse,
  ): [ApprovalStatus, ToolContext] {
    const pending = this.pending.get(id);

    if (pending) {
      this.pending.delete(id);
      this.completed.set(id, req.status);
      pending.resolve(req.status);

      // Clear timeout if exists
      const timeout = this.timeouts.get(id);
      if (timeout) {
        clearTimeout(timeout);
        this.timeouts.delete(id);
      }

      const store = this.msgStores.get(pending.executionProcessId);
      if (store) {
        const toolStatus = toolStatusFromApprovalStatus(req.status);
        if (!toolStatus) {
          throw ApprovalError.custom('Invalid approval status');
        }
        const updatedEntry = withToolStatus(pending.entry, toolStatus);
        if (!updatedEntry) {
          throw ApprovalError.noToolUseEntry();
        }
        store.push({ JsonPatch: ConversationPatch.replace(pending.entryIndex, updatedEntry) });
      } else {
        console.warn(
          `No msg_store found for execution_process_id: ${pending.executionProcessId}`,
        );
      }

      const toolCtx: ToolContext = {
        toolName: pending.toolName,
        executionProcessId: pending.executionProcessId,
      };

      // If approved or denied, and task is still InReview, move back to InProgress
      if (req.status.status === 'approved' || req.status.status === 'denied') {
        try {
          const epRepo = new ExecutionProcessRepository(db);
          const ctx = epRepo.loadContext(pending.executionProcessId);
          if (ctx && ctx.task.status === 'inreview') {
            const taskRepo = new TaskRepository(db);
            taskRepo.updateStatus(ctx.task.id, 'inprogress');
          }
        } catch (err) {
          console.warn(
            `Failed to update task status to InProgress after approval response: ${err}`,
          );
        }
      }

      return [req.status, toolCtx];
    } else if (this.completed.has(id)) {
      throw ApprovalError.alreadyCompleted();
    } else {
      throw ApprovalError.notFound();
    }
  }

  cancel(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;

    this.pending.delete(id);
    const deniedStatus: ApprovalStatus = { status: 'denied', reason: 'Cancelled' };
    this.completed.set(id, deniedStatus);

    // Clear timeout
    const timeout = this.timeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(id);
    }

    const store = this.msgStores.get(pending.executionProcessId);
    if (store) {
      const entry = withToolStatus(pending.entry, {
        status: 'denied',
        reason: 'Cancelled',
      });
      if (entry) {
        store.push({ JsonPatch: ConversationPatch.replace(pending.entryIndex, entry) });
      }
    }

    console.debug(`Cancelled approval '${id}'`);
  }

  /**
   * Check which execution processes have pending approvals.
   * Returns a set of execution_process_ids that have at least one pending approval.
   */
  getPendingExecutionProcessIds(executionProcessIds: string[]): Set<string> {
    const idSet = new Set(executionProcessIds);
    const result = new Set<string>();
    for (const entry of this.pending.values()) {
      if (idSet.has(entry.executionProcessId)) {
        result.add(entry.executionProcessId);
      }
    }
    return result;
  }

  private spawnTimeoutWatcher(
    id: string,
    timeoutAt: string,
    waiterPromise: Promise<ApprovalStatus>,
  ): void {
    const timeoutMs = Math.max(0, new Date(timeoutAt).getTime() - Date.now());

    const timedOutStatus: ApprovalStatus = { status: 'timed_out' };

    const timeoutPromise = new Promise<ApprovalStatus>((resolve) => {
      const timer = setTimeout(() => resolve(timedOutStatus), timeoutMs);
      this.timeouts.set(id, timer);
    });

    // Race between approval response and timeout
    void Promise.race([waiterPromise, timeoutPromise]).then((status) => {
      this.completed.set(id, status);

      if (status.status === 'timed_out') {
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          pending.resolve(status);

          const store = this.msgStores.get(pending.executionProcessId);
          if (store) {
            const updated = withToolStatus(pending.entry, { status: 'timed_out' });
            if (updated) {
              store.push({ JsonPatch: ConversationPatch.replace(pending.entryIndex, updated) });
            } else {
              console.warn(
                `Timed out approval '${id}' but couldn't update tool status (no tool-use entry).`,
              );
            }
          } else {
            console.warn(
              `No msg_store found for execution_process_id: ${pending.executionProcessId}`,
            );
          }
        }
      }

      // Clear timeout on resolution
      const timer = this.timeouts.get(id);
      if (timer) {
        clearTimeout(timer);
        this.timeouts.delete(id);
      }
    });
  }
}

// ── Helper: ensure task transitions to InReview ──

export function ensureTaskInReview(
  db: DatabaseType,
  executionProcessId: string,
): void {
  try {
    const epRepo = new ExecutionProcessRepository(db);
    const ctx = epRepo.loadContext(executionProcessId);
    if (ctx && ctx.task.status === 'inprogress') {
      const taskRepo = new TaskRepository(db);
      taskRepo.updateStatus(ctx.task.id, 'inreview');
    }
  } catch (err) {
    console.warn(
      `Failed to update task status to InReview for approval request: ${err}`,
    );
  }
}

// ── Helper: find matching tool use entry ──

/**
 * Find a matching tool use entry that hasn't been assigned to an approval yet.
 * Matches by tool call id from tool metadata.
 */
function findMatchingToolUse(
  store: MsgStore,
  toolCallId: string,
): [number, NormalizedEntry] | undefined {
  const history = store.history();

  // Iterate in reverse to find the most recent match
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (!entry) continue;
    const msg = entry.msg;

    if (!isJsonPatch(msg)) continue;

    const patch = msg.JsonPatch as Patch;
    const extracted = extractNormalizedEntryFromPatch(patch);
    if (!extracted) continue;

    const [idx, normalizedEntry] = extracted;

    // Must be a tool_use entry
    if (normalizedEntry.entryType.type !== 'tool_use') continue;

    // Only match tools in 'created' status
    if (normalizedEntry.entryType.status.status !== 'created') continue;

    // Match by tool call id from metadata
    if (normalizedEntry.metadata) {
      try {
        const metadata = normalizedEntry.metadata as ToolCallMetadata;
        if (metadata.toolCallId === toolCallId) {
          console.debug(
            `Matched tool use entry at index ${idx} for tool call id '${toolCallId}'`,
          );
          return [idx, normalizedEntry];
        }
      } catch {
        // metadata doesn't match expected shape, skip
      }
    }
  }

  return undefined;
}
