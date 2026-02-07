/**
 * Pull Requests API types
 * Translates: crates/utils/src/api/pull_requests.rs
 */

/** Matches Rust: #[serde(rename_all = "snake_case")] */
export type PullRequestStatus = 'open' | 'merged' | 'closed';

export interface UpsertPullRequestRequest {
  url: string;
  number: number;
  status: PullRequestStatus;
  mergedAt?: string;
  mergeCommitSha?: string;
  targetBranchName: string;
  localWorkspaceId: string;
}
