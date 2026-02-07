/**
 * Container service - Workspace/execution management
 * Translates: crates/services/src/container.rs
 *
 * In local deployment, "containers" are git worktrees (not Docker containers).
 * This service manages the lifecycle of workspaces, execution processes,
 * and the orchestration of coding agents.
 */

import type { DBService } from '@runner/db';
import {
  type MsgStore,
  MsgStoreMap,
  finishedMsg,
  gitBranchId,
  shortUuid,
} from '@runner/utils';
import type { GitService } from './git.js';
import type { EventsService } from './events.js';

export interface ContainerConfig {
  gitBranchPrefix?: string;
  autoCommit?: boolean;
}

export interface ExecutionProcessHandle {
  id: string;
  sessionId: string;
  pid?: number;
  abortController: AbortController;
}

export interface WorkspaceContext {
  workspaceId: string;
  repoPath: string;
  worktreePath?: string;
  branch: string;
}

export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'stopped';

export interface SetupAction {
  type: 'script';
  script: string;
  cwd: string;
  context: 'setup' | 'cleanup' | 'archive' | 'devserver';
}

/**
 * ContainerService manages the orchestration of workspaces and execution processes.
 * It coordinates between git worktrees, coding agent executors, and the database.
 */
export class ContainerService {
  private msgStores = new MsgStoreMap();
  private dbStreamHandles = new Map<string, AbortController>();
  private runningProcesses = new Map<string, ExecutionProcessHandle>();

  constructor(private config: ContainerConfig) {}

  // ─── Message Store Access ─────────────────────────────────────────

  /** Get the message store map for log streaming */
  msgStoreMap(): MsgStoreMap {
    return this.msgStores;
  }

  /** Get message store for a specific execution */
  getMsgStoreById(executionId: string): MsgStore | undefined {
    return this.msgStores.get(executionId);
  }

  /** Get or create a message store for an execution */
  getOrCreateMsgStore(executionId: string): MsgStore {
    return this.msgStores.getOrCreate(executionId);
  }

  // ─── DB Stream Handle Management ──────────────────────────────────

  /** Store a background task handle for streaming logs to DB */
  storeDbStreamHandle(executionId: string, controller: AbortController): void {
    this.dbStreamHandles.set(executionId, controller);
  }

  /** Retrieve and remove a DB stream task handle */
  takeDbStreamHandle(executionId: string): AbortController | undefined {
    const handle = this.dbStreamHandles.get(executionId);
    if (handle) {
      this.dbStreamHandles.delete(executionId);
    }
    return handle;
  }

  // ─── Workspace Path Resolution ────────────────────────────────────

  /** Convert a workspace to a filesystem directory path */
  workspaceToCurrentDir(workspaceContext: WorkspaceContext): string {
    return workspaceContext.worktreePath ?? workspaceContext.repoPath;
  }

  // ─── Execution Lifecycle ──────────────────────────────────────────

  /** Register a running execution process */
  registerProcess(handle: ExecutionProcessHandle): void {
    this.runningProcesses.set(handle.id, handle);
  }

  /** Remove a process from the running set */
  unregisterProcess(executionId: string): void {
    this.runningProcesses.delete(executionId);
  }

  /** Stop a running execution process */
  async stopExecution(executionId: string): Promise<boolean> {
    const handle = this.runningProcesses.get(executionId);
    if (!handle) return false;

    handle.abortController.abort();
    this.runningProcesses.delete(executionId);

    // Close the message store
    const store = this.msgStores.get(executionId);
    if (store) {
      store.push(finishedMsg(-1));
      store.close();
    }

    // Cancel any DB stream
    const dbHandle = this.dbStreamHandles.get(executionId);
    if (dbHandle) {
      dbHandle.abort();
      this.dbStreamHandles.delete(executionId);
    }

    return true;
  }

  /** Kill all running processes */
  async killAllRunningProcesses(): Promise<void> {
    const ids = [...this.runningProcesses.keys()];
    await Promise.all(ids.map(id => this.stopExecution(id)));
  }

  /** Check if a workspace has any running execution processes */
  hasRunningProcesses(sessionId: string): boolean {
    for (const handle of this.runningProcesses.values()) {
      if (handle.sessionId === sessionId) return true;
    }
    return false;
  }

  /** Get all running processes for a session */
  getRunningProcessesForSession(sessionId: string): ExecutionProcessHandle[] {
    return [...this.runningProcesses.values()].filter(h => h.sessionId === sessionId);
  }

  // ─── Git Branch Management ────────────────────────────────────────

  /** Get the configured git branch prefix */
  gitBranchPrefix(): string {
    return this.config.gitBranchPrefix ?? 'vk';
  }

  /** Generate a branch name from workspace + task context */
  gitBranchFromWorkspace(taskTitle: string, workspaceId: string): string {
    const prefix = this.gitBranchPrefix();
    const slug = gitBranchId(taskTitle);
    const short = shortUuid(workspaceId);
    return `${prefix}/${slug}-${short}`;
  }

  /** Check if an execution made any git commits */
  async hasCommitsFromExecution(
    gitService: GitService,
    beforeCommit: string | undefined
  ): Promise<boolean> {
    if (!beforeCommit) return false;
    return gitService.hasCommitsSince(beforeCommit);
  }

  // ─── Finalization ─────────────────────────────────────────────────

  /** Determine if execution should finalize the task */
  shouldFinalize(exitCode: number, runReason: string): boolean {
    return exitCode === 0 && (
      runReason === 'initial_request' ||
      runReason === 'follow_up_request' ||
      runReason === 'review_request'
    );
  }

  /** Finalize a task - update status and send notifications */
  async finalizeTask(
    db: DBService,
    taskId: string,
    eventsService?: EventsService,
  ): Promise<void> {
    db.prepare(
      "UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?"
    ).run('in_review', taskId);

    if (eventsService) {
      await eventsService.emit('task.completed', { taskId });
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────────

  /** Clean up processes orphaned from crashes/restarts */
  async cleanupOrphanExecutions(db: DBService): Promise<number> {
    const result = db.prepare(
      `UPDATE execution_processes
       SET status = 'failed', completed_at = datetime('now'), updated_at = datetime('now')
       WHERE status = 'running'`
    ).run() as { changes: number };
    return result.changes ?? 0;
  }

  /** Check if workspace has uncommitted changes */
  async isContainerClean(gitService: GitService): Promise<boolean> {
    return gitService.isClean();
  }

  // ─── Script Management ────────────────────────────────────────────

  /** Build a setup action descriptor for a single repo */
  setupActionForRepo(
    repoPath: string,
    setupScript: string | null,
    workingDir?: string
  ): SetupAction | null {
    if (!setupScript) return null;
    return {
      type: 'script',
      script: setupScript,
      cwd: workingDir ?? repoPath,
      context: 'setup',
    };
  }

  /** Build setup actions for multiple repos */
  setupActionsForRepos(
    repos: Array<{ path: string; setupScript: string | null; workingDir?: string }>
  ): SetupAction[] {
    return repos
      .map(r => this.setupActionForRepo(r.path, r.setupScript, r.workingDir))
      .filter((a): a is SetupAction => a !== null);
  }

  /** Build cleanup actions for repos */
  cleanupActionsForRepos(
    repos: Array<{ path: string; cleanupScript: string | null; workingDir?: string }>
  ): SetupAction[] {
    return repos
      .filter(r => r.cleanupScript)
      .map(r => ({
        type: 'script' as const,
        script: r.cleanupScript!,
        cwd: r.workingDir ?? r.path,
        context: 'cleanup' as const,
      }));
  }

  /** Build archive actions for repos */
  archiveActionsForRepos(
    repos: Array<{ path: string; archiveScript: string | null; workingDir?: string }>
  ): SetupAction[] {
    return repos
      .filter(r => r.archiveScript)
      .map(r => ({
        type: 'script' as const,
        script: r.archiveScript!,
        cwd: r.workingDir ?? r.path,
        context: 'archive' as const,
      }));
  }

  /** Chain multiple setup scripts to run sequentially */
  buildSequentialSetupChain(actions: SetupAction[]): SetupAction[] {
    return actions;
  }
}
