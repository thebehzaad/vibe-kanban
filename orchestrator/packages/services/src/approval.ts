/**
 * Approval service
 * Translates: crates/services/src/approval.rs
 */

export type ApprovalType = 'file_edit' | 'file_create' | 'file_delete' | 'command_execution' | 'git_operation' | 'network_request' | 'custom';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalRequest {
  id: string;
  executionId: string;
  type: ApprovalType;
  description: string;
  metadata?: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: Date;
  expiresAt?: Date;
  respondedAt?: Date;
  response?: string;
}

export type ApprovalCallback = (request: ApprovalRequest) => void;

export class ApprovalService {
  private pendingApprovals = new Map<string, ApprovalRequest>();
  private callbacks = new Map<string, ApprovalCallback>();
  private expirationTimers = new Map<string, NodeJS.Timeout>();

  /** Create an approval request */
  createRequest(params: {
    executionId: string;
    type: ApprovalType;
    description: string;
    metadata?: Record<string, unknown>;
    timeoutMs?: number;
  }): ApprovalRequest {
    const request: ApprovalRequest = {
      id: crypto.randomUUID(),
      executionId: params.executionId,
      type: params.type,
      description: params.description,
      metadata: params.metadata,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: params.timeoutMs ? new Date(Date.now() + params.timeoutMs) : undefined,
    };

    this.pendingApprovals.set(request.id, request);

    // Set expiration timer if timeout specified
    if (params.timeoutMs) {
      const timer = setTimeout(() => {
        this.expireRequest(request.id);
      }, params.timeoutMs);
      this.expirationTimers.set(request.id, timer);
    }

    return request;
  }

  /** Wait for a response to an approval request */
  waitForResponse(requestId: string): Promise<ApprovalRequest> {
    return new Promise((resolve) => {
      const request = this.pendingApprovals.get(requestId);
      if (request && request.status !== 'pending') {
        resolve(request);
        return;
      }

      this.callbacks.set(requestId, (req) => {
        resolve(req);
      });
    });
  }

  /** Respond to an approval request */
  respond(requestId: string, approved: boolean, response?: string): ApprovalRequest | undefined {
    const request = this.pendingApprovals.get(requestId);
    if (!request || request.status !== 'pending') return undefined;

    request.status = approved ? 'approved' : 'rejected';
    request.respondedAt = new Date();
    request.response = response;

    // Clear expiration timer
    const timer = this.expirationTimers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      this.expirationTimers.delete(requestId);
    }

    // Notify callback
    const callback = this.callbacks.get(requestId);
    if (callback) {
      callback(request);
      this.callbacks.delete(requestId);
    }

    return request;
  }

  /** Get a specific approval request */
  getRequest(requestId: string): ApprovalRequest | undefined {
    return this.pendingApprovals.get(requestId);
  }

  /** List all pending approvals */
  listPending(): ApprovalRequest[] {
    return [...this.pendingApprovals.values()].filter(r => r.status === 'pending');
  }

  /** List pending approvals for a specific execution */
  listPendingForExecution(executionId: string): ApprovalRequest[] {
    return [...this.pendingApprovals.values()].filter(
      r => r.executionId === executionId && r.status === 'pending'
    );
  }

  private expireRequest(requestId: string): void {
    const request = this.pendingApprovals.get(requestId);
    if (request && request.status === 'pending') {
      request.status = 'expired';
      request.respondedAt = new Date();

      const callback = this.callbacks.get(requestId);
      if (callback) {
        callback(request);
        this.callbacks.delete(requestId);
      }
    }
    this.expirationTimers.delete(requestId);
  }

  /** Cleanup all pending requests */
  cleanup(): void {
    for (const timer of this.expirationTimers.values()) {
      clearTimeout(timer);
    }
    this.expirationTimers.clear();
    this.callbacks.clear();
    this.pendingApprovals.clear();
  }
}
