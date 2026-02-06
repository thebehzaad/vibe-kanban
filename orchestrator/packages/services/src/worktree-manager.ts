/**
 * Worktree manager service
 * Translates: crates/services/src/services/worktree_manager.rs
 *
 * Manages git worktrees for parallel task attempts.
 */

export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
  locked: boolean;
}

export class WorktreeManagerService {
  // TODO: Implement worktree management
  async createWorktree(repoPath: string, branch: string, targetPath: string): Promise<WorktreeInfo> {
    throw new Error('Not implemented');
  }

  async removeWorktree(path: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
    throw new Error('Not implemented');
  }
}
