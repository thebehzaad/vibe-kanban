/**
 * Execution process repo state model
 * Translates: crates/db/src/models/execution_process_repo_state.rs
 */

import type { DatabaseType } from '../connection.js';
import { randomUUID } from 'node:crypto';

// --- Types ---

export interface ExecutionProcessRepoState {
  id: string;
  executionProcessId: string;
  repoId: string;
  beforeHeadCommit?: string;
  afterHeadCommit?: string;
  mergeCommit?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExecutionProcessRepoState {
  repoId: string;
  beforeHeadCommit?: string;
  afterHeadCommit?: string;
  mergeCommit?: string;
}

// --- Row mapping ---

function rowToState(row: any): ExecutionProcessRepoState {
  return {
    id: row.id,
    executionProcessId: row.execution_process_id,
    repoId: row.repo_id,
    beforeHeadCommit: row.before_head_commit ?? undefined,
    afterHeadCommit: row.after_head_commit ?? undefined,
    mergeCommit: row.merge_commit ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Repository ---

export class ExecutionProcessRepoStateRepository {
  constructor(private db: DatabaseType) {}

  createMany(executionProcessId: string, entries: CreateExecutionProcessRepoState[]): void {
    if (entries.length === 0) return;

    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT INTO execution_process_repo_states (
        id, execution_process_id, repo_id, before_head_commit, after_head_commit, merge_commit,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertMany = this.db.transaction((items: CreateExecutionProcessRepoState[]) => {
      for (const entry of items) {
        stmt.run(
          randomUUID(),
          executionProcessId,
          entry.repoId,
          entry.beforeHeadCommit ?? null,
          entry.afterHeadCommit ?? null,
          entry.mergeCommit ?? null,
          now,
          now,
        );
      }
    });

    insertMany(entries);
  }

  updateBeforeHeadCommit(
    executionProcessId: string,
    repoId: string,
    beforeHeadCommit: string,
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE execution_process_repo_states
         SET before_head_commit = ?, updated_at = ?
         WHERE execution_process_id = ? AND repo_id = ?`,
      )
      .run(beforeHeadCommit, now, executionProcessId, repoId);
  }

  updateAfterHeadCommit(
    executionProcessId: string,
    repoId: string,
    afterHeadCommit: string,
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE execution_process_repo_states
         SET after_head_commit = ?, updated_at = ?
         WHERE execution_process_id = ? AND repo_id = ?`,
      )
      .run(afterHeadCommit, now, executionProcessId, repoId);
  }

  setMergeCommit(executionProcessId: string, repoId: string, mergeCommit: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE execution_process_repo_states
         SET merge_commit = ?, updated_at = ?
         WHERE execution_process_id = ? AND repo_id = ?`,
      )
      .run(mergeCommit, now, executionProcessId, repoId);
  }

  findByExecutionProcessId(executionProcessId: string): ExecutionProcessRepoState[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM execution_process_repo_states
         WHERE execution_process_id = ? ORDER BY created_at ASC`,
      )
      .all(executionProcessId) as any[];
    return rows.map(rowToState);
  }
}
