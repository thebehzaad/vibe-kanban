/**
 * Approvals routes
 * Translates: crates/server/src/routes/approvals.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';

// Types
export interface Approval {
  id: string;
  type: ApprovalType;
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  executionProcessId: string;
  sessionId: string;
  createdAt: string;
  expiresAt?: string;
}

export type ApprovalType =
  | 'file_edit'
  | 'file_create'
  | 'file_delete'
  | 'command_execution'
  | 'git_operation'
  | 'network_request'
  | 'custom';

export interface ApprovalResponse {
  approved: boolean;
  feedback?: string;
  modifiedContent?: string;
}

export interface RespondToApprovalBody {
  response: ApprovalResponse;
}

// In-memory store
const approvals = new Map<string, Approval>();
const approvalCallbacks = new Map<string, (response: ApprovalResponse) => void>();

export const approvalRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // POST /api/approvals/:id/respond - Respond to an approval
  fastify.post<{ Params: { id: string }; Body: RespondToApprovalBody }>(
    '/approvals/:id/respond',
    async (request, reply) => {
      const { id } = request.params;
      const { response } = request.body;

      const approval = approvals.get(id);
      if (!approval) {
        return reply.status(404).send({ error: 'Approval not found' });
      }

      if (approval.status !== 'pending') {
        return reply.status(400).send({ error: `Approval already ${approval.status}` });
      }

      // Check expiration
      if (approval.expiresAt && new Date(approval.expiresAt) < new Date()) {
        approval.status = 'expired';
        approvals.set(id, approval);
        return reply.status(400).send({ error: 'Approval has expired' });
      }

      // Update approval status
      approval.status = response.approved ? 'approved' : 'rejected';
      approvals.set(id, approval);

      // Trigger callback if registered
      const callback = approvalCallbacks.get(id);
      if (callback) {
        callback(response);
        approvalCallbacks.delete(id);
      }

      fastify.log.info(`Approval ${id} ${approval.status}: ${approval.title}`);

      return {
        success: true,
        approvalId: id,
        status: approval.status,
        feedback: response.feedback
      };
    }
  );

  // GET /api/approvals/:id - Get approval details (internal helper)
  fastify.get<{ Params: { id: string } }>('/approvals/:id', async (request, reply) => {
    const { id } = request.params;
    const approval = approvals.get(id);

    if (!approval) {
      return reply.status(404).send({ error: 'Approval not found' });
    }

    return approval;
  });

  // GET /api/approvals - List pending approvals
  fastify.get<{ Querystring: { session_id?: string; status?: string } }>(
    '/approvals',
    async (request) => {
      const { session_id, status } = request.query;

      let results = Array.from(approvals.values());

      if (session_id) {
        results = results.filter(a => a.sessionId === session_id);
      }

      if (status) {
        results = results.filter(a => a.status === status);
      }

      return {
        approvals: results,
        total: results.length
      };
    }
  );
};

// Helper functions for creating approvals (used by execution processes)
export function createApproval(
  type: ApprovalType,
  title: string,
  description: string,
  executionProcessId: string,
  sessionId: string,
  metadata: Record<string, unknown> = {},
  timeoutMs?: number
): Promise<ApprovalResponse> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const now = new Date();

    const approval: Approval = {
      id,
      type,
      title,
      description,
      metadata,
      status: 'pending',
      executionProcessId,
      sessionId,
      createdAt: now.toISOString(),
      expiresAt: timeoutMs
        ? new Date(now.getTime() + timeoutMs).toISOString()
        : undefined
    };

    approvals.set(id, approval);

    // Register callback
    approvalCallbacks.set(id, resolve);

    // Set timeout if specified
    if (timeoutMs) {
      setTimeout(() => {
        const currentApproval = approvals.get(id);
        if (currentApproval?.status === 'pending') {
          currentApproval.status = 'expired';
          approvals.set(id, currentApproval);
          approvalCallbacks.delete(id);
          reject(new Error('Approval timed out'));
        }
      }, timeoutMs);
    }
  });
}

export function getApproval(id: string): Approval | undefined {
  return approvals.get(id);
}
