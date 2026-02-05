/**
 * GitHub integration
 * Translates: crates/review/src/github.rs
 */

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
  diff: string;
}

export async function fetchPullRequest(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PullRequest> {
  // TODO: Implement using gh CLI or GitHub API
  throw new Error('Not implemented');
}

export async function submitReviewComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
): Promise<void> {
  // TODO: Implement using gh CLI or GitHub API
  throw new Error('Not implemented');
}
