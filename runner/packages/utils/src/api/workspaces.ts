/**
 * Workspaces API types
 * Translates: crates/utils/src/api/workspaces.rs
 */

export interface DeleteWorkspaceRequest {
  localWorkspaceId: string;
}

export interface CreateWorkspaceRequest {
  projectId: string;
  localWorkspaceId: string;
  issueId: string;
  name?: string;
  archived?: boolean;
  filesChanged?: number;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface UpdateWorkspaceRequest {
  localWorkspaceId: string;
  /** Option<Option<String>> in Rust — null means "set to None", undefined means "don't change" */
  name?: string | null;
  archived?: boolean;
  /** Option<Option<i32>> in Rust */
  filesChanged?: number | null;
  /** Option<Option<i32>> in Rust */
  linesAdded?: number | null;
  /** Option<Option<i32>> in Rust */
  linesRemoved?: number | null;
}
