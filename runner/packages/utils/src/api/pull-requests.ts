/**
 * Pull Requests API types
 * Translates: crates/utils/src/api/pull_requests.rs
 *
 * API types for pull request operations.
 */

export interface CreatePullRequestRequest {
  title: string;
  body?: string;
  head: string;
  base: string;
  draft?: boolean;
}

export interface PullRequestResponse {
  id: string;
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    username: string;
    avatarUrl?: string;
  };
}

export interface UpdatePullRequestRequest {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
}

export interface PullRequestComment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  position?: number;
  path?: string;
}

export interface CreatePRCommentRequest {
  body: string;
  path?: string;
  position?: number;
}

export interface MergePullRequestRequest {
  commitTitle?: string;
  commitMessage?: string;
  mergeMethod?: 'merge' | 'squash' | 'rebase';
}
