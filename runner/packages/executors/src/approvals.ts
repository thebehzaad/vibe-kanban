/**
 * Executor approvals
 * Translates: crates/executors/src/approvals.rs
 *
 * Approval handling for executor actions.
 */

// TODO: Implement executor approvals
export interface ExecutorApproval {
  id: string;
  type: string;
  message: string;
  approved: boolean;
}
