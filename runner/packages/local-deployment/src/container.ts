/**
 * LocalContainerService - Core execution engine for local deployment
 * Translates: crates/local-deployment/src/container.rs
 *
 * This is the orchestration brain - it monitors child processes,
 * handles follow-up messages, auto-commits, and finalizes tasks.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  MsgStore,
  stdoutMsg,
  stderrMsg,
  finishedMsg,
  type LogMsg,
  killProcessTree,
  waitForExit,
  getShellCommand,
} from '@runner/utils';
import type { DBService } from '@runner/db';
import type {
  ContainerService,
  GitService,
  EventsService,
  QueuedMessageService,
  NotificationService,
  ApprovalService,
} from '@runner/services';
import type { BaseExecutor, ClaudeExecutor } from '@runner/executors';

export interface LocalContainerConfig {
  autoCommit: boolean;
  gitBranchPrefix: string;
}

export interface SpawnExitMonitorParams {
  executionId: string;
  sessionId: string;
  workspaceId: string;
  taskId: string;
  runReason: string;
  child: ChildProcess;
  msgStore: MsgStore;
  repoPath: string;
  beforeHeadCommit?: string;
}

/**
 * LocalContainerService handles the local execution lifecycle.
 * It spawns child processes, monitors their exit, and orchestrates
 * follow-up actions like auto-commit, queued messages, and task finalization.
 */
export class LocalContainerService {
  private runningChildren = new Map<string, ChildProcess>();

  constructor(
    private config: LocalContainerConfig,
    private db: DBService,
    private containerService: ContainerService,
    private eventsService: EventsService,
    private queuedMessageService: QueuedMessageService,
    private notificationService: NotificationService,
  ) {}

  /**
   * Core orchestration logic - monitor a child process after spawn.
   * On completion:
   * 1. Check for queued follow-up messages
   * 2. Auto-commit uncommitted changes
   * 3. Finalize task if appropriate
   * 4. Fire analytics events
   */
  async spawnExitMonitor(params: SpawnExitMonitorParams): Promise<void> {
    const {
      executionId, sessionId, workspaceId, taskId,
      runReason, child, msgStore, repoPath, beforeHeadCommit,
    } = params;

    this.runningChildren.set(executionId, child);

    // Wait for the child process to exit
    const exitCode = await waitForExit(child);

    this.runningChildren.delete(executionId);
    this.containerService.unregisterProcess(executionId);

    // Update execution process in DB
    this.db.prepare(
      `UPDATE execution_processes
       SET status = ?, exit_code = ?, completed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    ).run(exitCode === 0 ? 'completed' : 'failed', exitCode, executionId);

    // Record after-head commit
    const gitService = new (await import('@runner/services')).GitService({ repoPath });
    try {
      const afterCommit = await gitService.revParse('HEAD');
      this.db.prepare(
        `UPDATE execution_process_repo_states
         SET after_head_commit = ?
         WHERE execution_process_id = ?`
      ).run(afterCommit, executionId);
    } catch {
      // Ignore git errors
    }

    // Emit completion event
    await this.eventsService.emit(
      exitCode === 0 ? 'execution.completed' : 'execution.failed',
      { executionId, sessionId, workspaceId, taskId, exitCode }
    );

    // Check for queued follow-up messages
    if (exitCode === 0 && this.queuedMessageService.hasMessages(workspaceId)) {
      const queued = this.queuedMessageService.dequeue(workspaceId);
      if (queued) {
        await this.startQueuedFollowUp(queued.prompt, sessionId, workspaceId, taskId, repoPath);
        return; // Don't finalize yet - the follow-up will handle it
      }
    }

    // Auto-commit uncommitted changes
    if (this.config.autoCommit) {
      try {
        const hasChanges = await gitService.hasUncommittedChanges();
        if (hasChanges) {
          await gitService.autoCommit('[vibe-kanban] Auto-commit changes');
        }
      } catch {
        // Auto-commit failure is non-critical
      }
    }

    // Finalize task if appropriate
    if (this.containerService.shouldFinalize(exitCode ?? 1, runReason)) {
      await this.containerService.finalizeTask(this.db, taskId, this.eventsService);
      await this.notificationService.sendTaskComplete(
        this.getTaskTitle(taskId) ?? 'Task'
      );
    }
  }

  /** Start a queued follow-up message */
  private async startQueuedFollowUp(
    prompt: string,
    sessionId: string,
    workspaceId: string,
    taskId: string,
    repoPath: string,
  ): Promise<void> {
    // Create a new execution process for the follow-up
    const executionId = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(
      `INSERT INTO execution_processes (id, session_id, run_reason, executor_action, status, started_at, created_at, updated_at)
       VALUES (?, ?, 'follow_up_request', 'coding_agent_follow_up', 'running', ?, ?, ?)`
    ).run(executionId, sessionId, now, now, now);

    await this.eventsService.emit('execution.started', {
      executionId, sessionId, workspaceId, taskId,
      runReason: 'follow_up_request',
    });
  }

  /** Spawn a script execution (setup/cleanup/archive/devserver) */
  async spawnScript(
    script: string,
    cwd: string,
    executionId: string,
    sessionId: string,
  ): Promise<{ child: ChildProcess; msgStore: MsgStore }> {
    const msgStore = this.containerService.getOrCreateMsgStore(executionId);
    const { shell, shellArg } = getShellCommand();

    const child = spawn(shell, [shellArg, script], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    child.stdout?.on('data', (data: Buffer) => {
      msgStore.push(stdoutMsg(data.toString()));
    });

    child.stderr?.on('data', (data: Buffer) => {
      msgStore.push(stderrMsg(data.toString()));
    });

    child.on('close', (code) => {
      msgStore.push(finishedMsg(code ?? 1));
      msgStore.close();
    });

    return { child, msgStore };
  }

  /** Stop a running execution */
  async stopExecution(executionId: string): Promise<boolean> {
    const child = this.runningChildren.get(executionId);
    if (!child || !child.pid) return false;

    await killProcessTree(child.pid);
    this.runningChildren.delete(executionId);
    return true;
  }

  /** Get a running child process */
  getRunningChild(executionId: string): ChildProcess | undefined {
    return this.runningChildren.get(executionId);
  }

  /** Clean up workspace resources */
  async cleanupWorkspace(workspaceId: string, repoPath: string): Promise<void> {
    // Stop any running processes for this workspace
    const sessions = this.db.prepare(
      'SELECT id FROM sessions WHERE workspace_id = ?'
    ).all(workspaceId) as { id: string }[];

    for (const session of sessions) {
      const processes = this.containerService.getRunningProcessesForSession(session.id);
      for (const proc of processes) {
        await this.containerService.stopExecution(proc.id);
      }
    }
  }

  private getTaskTitle(taskId: string): string | undefined {
    const task = this.db.prepare(
      'SELECT title FROM tasks WHERE id = ?'
    ).get(taskId) as { title: string } | undefined;
    return task?.title;
  }
}
