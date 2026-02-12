/**
 * Executor approval bridge
 * Translates: crates/services/src/services/approvals/executor_approvals.rs
 *
 * Bridges the executor approval interface with the service-layer Approvals system.
 * Implements ExecutorApprovalService for use by executors.
 */

import type { DatabaseType } from '@runner/db';
import { ExecutionProcessRepository } from '@runner/db';
import type { ApprovalStatus } from '@runner/utils';
import { createApprovalRequest } from '@runner/utils';
import {
  type ExecutorApprovalService,
  ExecutorApprovalError,
} from '@runner/executors';

import { Approvals, ensureTaskInReview } from './approval.js';
import type { NotificationService } from './notification.js';

// ── ExecutorApprovalBridge ──

export class ExecutorApprovalBridge implements ExecutorApprovalService {
  constructor(
    private approvals: Approvals,
    private db: DatabaseType,
    private notificationService: NotificationService,
    private executionProcessId: string,
  ) {}

  async requestToolApproval(
    toolName: string,
    toolInput: unknown,
    toolCallId: string,
    cancel: AbortSignal,
  ): Promise<ApprovalStatus> {
    ensureTaskInReview(this.db, this.executionProcessId);

    const request = createApprovalRequest(
      { toolName, toolInput, toolCallId },
      this.executionProcessId,
    );

    const [req, waiter] = this.approvals.createWithWaiter(request);
    const approvalId = req.id;

    // Get task name for notification
    const epRepo = new ExecutionProcessRepository(this.db);
    const ctx = epRepo.loadContext(this.executionProcessId);
    const taskName = ctx?.task.title ?? 'Unknown task';

    await this.notificationService.notify(
      `Approval Needed: ${taskName}`,
      `Tool '${toolName}' requires approval`,
    );

    // Race between cancellation and approval
    const status = await new Promise<ApprovalStatus>((resolve, reject) => {
      if (cancel.aborted) {
        this.approvals.cancel(approvalId);
        reject(ExecutorApprovalError.cancelled());
        return;
      }

      let settled = false;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        console.info(`Approval request cancelled for tool_call_id=${toolCallId}`);
        this.approvals.cancel(approvalId);
        reject(ExecutorApprovalError.cancelled());
      };

      cancel.addEventListener('abort', onAbort, { once: true });

      waiter.then((s) => {
        if (settled) return;
        settled = true;
        cancel.removeEventListener('abort', onAbort);
        resolve(s);
      });
    });

    if (status.status === 'pending') {
      throw ExecutorApprovalError.requestFailed(
        'approval finished in pending state',
      );
    }

    return status;
  }
}
