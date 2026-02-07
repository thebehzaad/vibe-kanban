/**
 * Workspaces API types
 * Translates: crates/utils/src/api/workspaces.rs
 *
 * API types for workspace operations.
 */

export interface CreateWorkspaceRequest {
  taskId: string;
  branch: string;
  repos: WorkspaceRepoInput[];
  executorProfileId?: string;
}

export interface WorkspaceRepoInput {
  repoId: string;
  targetBranch: string;
}

export interface WorkspaceResponse {
  id: string;
  taskId: string;
  branch: string;
  status: 'initializing' | 'ready' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface UpdateWorkspaceRequest {
  status?: string;
  agentWorkingDir?: string;
}

export interface WorkspaceDiffResponse {
  files: DiffFile[];
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  patch?: string;
}

export interface CommitWorkspaceRequest {
  message: string;
  files?: string[];
}

export interface RebaseWorkspaceRequest {
  branch: string;
}

export interface MergeWorkspaceRequest {
  sourceBranch: string;
  targetBranch: string;
  message?: string;
}
