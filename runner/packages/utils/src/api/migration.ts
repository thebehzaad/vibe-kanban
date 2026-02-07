/**
 * Migration API types
 * Translates: crates/utils/src/api/migration.rs
 */

export interface MigrateProjectRequest {
  organizationId: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface MigrateIssueRequest {
  projectId: string;
  statusName: string;
  title: string;
  description?: string;
  createdAt: string;
}

export interface MigratePullRequestRequest {
  url: string;
  number: number;
  status: string;
  mergedAt?: string;
  mergeCommitSha?: string;
  targetBranchName: string;
  issueId: string;
}

export interface MigrateWorkspaceRequest {
  projectId: string;
  issueId?: string;
  localWorkspaceId: string;
  archived: boolean;
  createdAt: string;
}

export interface BulkMigrateRequest<T> {
  items: T[];
}

export interface BulkMigrateResponse {
  ids: string[];
}
