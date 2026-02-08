/**
 * Merge model
 * Translates: crates/db/src/models/merge.rs
 */

import type { DatabaseType } from '../connection.js';
import { randomUUID } from 'node:crypto';

// --- Types ---

export type MergeStatus = 'open' | 'merged' | 'closed' | 'unknown';

export interface DirectMerge {
  id: string;
  workspaceId: string;
  repoId: string;
  mergeCommit: string;
  targetBranchName: string;
  createdAt: string;
}

export interface PullRequestInfo {
  number: number;
  url: string;
  status: MergeStatus;
  mergedAt?: string;
  mergeCommitSha?: string;
}

export interface PrMerge {
  id: string;
  workspaceId: string;
  repoId: string;
  createdAt: string;
  targetBranchName: string;
  prInfo: PullRequestInfo;
}

export type Merge = { type: 'direct'; merge: DirectMerge } | { type: 'pr'; merge: PrMerge };

// --- Helper ---

export function mergeCommit(merge: Merge): string | undefined {
  switch (merge.type) {
    case 'direct':
      return merge.merge.mergeCommit;
    case 'pr':
      return merge.merge.prInfo.mergeCommitSha;
  }
}

function rowToDirectMerge(row: any): DirectMerge {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    repoId: row.repo_id,
    mergeCommit: row.merge_commit,
    targetBranchName: row.target_branch_name,
    createdAt: row.created_at,
  };
}

function rowToPrMerge(row: any): PrMerge {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    repoId: row.repo_id,
    createdAt: row.created_at,
    targetBranchName: row.target_branch_name,
    prInfo: {
      number: row.pr_number,
      url: row.pr_url,
      status: (row.pr_status ?? 'unknown') as MergeStatus,
      mergedAt: row.merged_at ?? undefined,
      mergeCommitSha: row.merge_commit_sha ?? undefined,
    },
  };
}

// --- Repository ---

export class MergeRepository {
  constructor(private db: DatabaseType) {}

  createDirect(
    workspaceId: string,
    repoId: string,
    targetBranchName: string,
    mergeCommitVal: string,
  ): DirectMerge {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO direct_merges (id, workspace_id, repo_id, merge_commit, target_branch_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, workspaceId, repoId, mergeCommitVal, targetBranchName, now);

    return {
      id,
      workspaceId,
      repoId,
      mergeCommit: mergeCommitVal,
      targetBranchName,
      createdAt: now,
    };
  }

  createPr(
    workspaceId: string,
    repoId: string,
    targetBranchName: string,
    prNumber: number,
    prUrl: string,
  ): PrMerge {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO pr_merges (id, workspace_id, repo_id, target_branch_name, pr_number, pr_url, pr_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(id, workspaceId, repoId, targetBranchName, prNumber, prUrl, now);

    return {
      id,
      workspaceId,
      repoId,
      createdAt: now,
      targetBranchName,
      prInfo: {
        number: prNumber,
        url: prUrl,
        status: 'open',
      },
    };
  }

  findAllPr(): PrMerge[] {
    const rows = this.db
      .prepare('SELECT * FROM pr_merges ORDER BY created_at ASC')
      .all() as any[];
    return rows.map(rowToPrMerge);
  }

  getOpenPrs(): PrMerge[] {
    const rows = this.db
      .prepare("SELECT * FROM pr_merges WHERE pr_status = 'open' ORDER BY created_at DESC")
      .all() as any[];
    return rows.map(rowToPrMerge);
  }

  updateStatus(mergeId: string, prStatus: MergeStatus, mergeCommitSha?: string): void {
    const mergedAt = prStatus === 'merged' ? new Date().toISOString() : null;
    this.db
      .prepare(
        'UPDATE pr_merges SET pr_status = ?, merge_commit_sha = ?, merged_at = ? WHERE id = ?',
      )
      .run(prStatus, mergeCommitSha ?? null, mergedAt, mergeId);
  }

  findByWorkspaceId(workspaceId: string): Merge[] {
    const directRows = this.db
      .prepare('SELECT * FROM direct_merges WHERE workspace_id = ? ORDER BY created_at DESC')
      .all(workspaceId) as any[];
    const prRows = this.db
      .prepare('SELECT * FROM pr_merges WHERE workspace_id = ? ORDER BY created_at DESC')
      .all(workspaceId) as any[];

    const merges: Merge[] = [
      ...directRows.map(
        (r): Merge => ({ type: 'direct', merge: rowToDirectMerge(r) }),
      ),
      ...prRows.map(
        (r): Merge => ({ type: 'pr', merge: rowToPrMerge(r) }),
      ),
    ];

    merges.sort((a, b) => {
      const aDate = a.type === 'direct' ? a.merge.createdAt : a.merge.createdAt;
      const bDate = b.type === 'direct' ? b.merge.createdAt : b.merge.createdAt;
      return bDate.localeCompare(aDate);
    });

    return merges;
  }

  findByWorkspaceAndRepoId(workspaceId: string, repoId: string): Merge[] {
    const directRows = this.db
      .prepare(
        'SELECT * FROM direct_merges WHERE workspace_id = ? AND repo_id = ? ORDER BY created_at DESC',
      )
      .all(workspaceId, repoId) as any[];
    const prRows = this.db
      .prepare(
        'SELECT * FROM pr_merges WHERE workspace_id = ? AND repo_id = ? ORDER BY created_at DESC',
      )
      .all(workspaceId, repoId) as any[];

    const merges: Merge[] = [
      ...directRows.map(
        (r): Merge => ({ type: 'direct', merge: rowToDirectMerge(r) }),
      ),
      ...prRows.map(
        (r): Merge => ({ type: 'pr', merge: rowToPrMerge(r) }),
      ),
    ];

    merges.sort((a, b) => {
      const aDate = a.type === 'direct' ? a.merge.createdAt : a.merge.createdAt;
      const bDate = b.type === 'direct' ? b.merge.createdAt : b.merge.createdAt;
      return bDate.localeCompare(aDate);
    });

    return merges;
  }

  getLatestPrStatusForWorkspaces(archived: boolean): Map<string, MergeStatus> {
    const rows = this.db
      .prepare(
        `SELECT pm.workspace_id, pm.pr_status
         FROM pr_merges pm
         INNER JOIN (
           SELECT workspace_id, MAX(created_at) as max_created_at
           FROM pr_merges
           GROUP BY workspace_id
         ) latest ON pm.workspace_id = latest.workspace_id
           AND pm.created_at = latest.max_created_at
         INNER JOIN workspaces w ON pm.workspace_id = w.id
         WHERE w.archived = ?`,
      )
      .all(archived ? 1 : 0) as any[];

    const result = new Map<string, MergeStatus>();
    for (const row of rows) {
      if (row.pr_status) {
        result.set(row.workspace_id, row.pr_status as MergeStatus);
      }
    }
    return result;
  }
}
