/**
 * Migration state model
 * Translates: crates/db/src/models/migration_state.rs
 *
 * Tracks entity migration state (project/task/workspace/PR to remote).
 */

import type { DatabaseType } from '../connection.js';
import { randomUUID } from 'node:crypto';

// --- Types ---

export type EntityType = 'project' | 'task' | 'prmerge' | 'workspace';
export type MigrationStatus = 'pending' | 'migrated' | 'failed' | 'skipped';

export interface MigrationState {
  id: string;
  entityType: EntityType;
  localId: string;
  remoteId?: string;
  status: MigrationStatus;
  errorMessage?: string;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMigrationState {
  entityType: EntityType;
  localId: string;
}

export interface MigrationStats {
  total: number;
  pending: number;
  migrated: number;
  failed: number;
  skipped: number;
}

// --- Row mapping ---

function rowToState(row: any): MigrationState {
  return {
    id: row.id,
    entityType: row.entity_type as EntityType,
    localId: row.local_id,
    remoteId: row.remote_id ?? undefined,
    status: row.status as MigrationStatus,
    errorMessage: row.error_message ?? undefined,
    attemptCount: row.attempt_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Repository ---

export class MigrationStateRepository {
  constructor(private db: DatabaseType) {}

  findAll(): MigrationState[] {
    const rows = this.db
      .prepare('SELECT * FROM migration_states ORDER BY created_at ASC')
      .all() as any[];
    return rows.map(rowToState);
  }

  findByEntityType(entityType: EntityType): MigrationState[] {
    const rows = this.db
      .prepare('SELECT * FROM migration_states WHERE entity_type = ? ORDER BY created_at ASC')
      .all(entityType) as any[];
    return rows.map(rowToState);
  }

  findByStatus(status: MigrationStatus): MigrationState[] {
    const rows = this.db
      .prepare('SELECT * FROM migration_states WHERE status = ? ORDER BY created_at ASC')
      .all(status) as any[];
    return rows.map(rowToState);
  }

  findPendingByType(entityType: EntityType): MigrationState[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM migration_states WHERE entity_type = ? AND status = 'pending' ORDER BY created_at ASC",
      )
      .all(entityType) as any[];
    return rows.map(rowToState);
  }

  findByEntity(entityType: EntityType, localId: string): MigrationState | undefined {
    const row = this.db
      .prepare('SELECT * FROM migration_states WHERE entity_type = ? AND local_id = ?')
      .get(entityType, localId) as any;
    return row ? rowToState(row) : undefined;
  }

  getRemoteId(entityType: EntityType, localId: string): string | undefined {
    const row = this.db
      .prepare(
        "SELECT remote_id FROM migration_states WHERE entity_type = ? AND local_id = ? AND status = 'migrated'",
      )
      .get(entityType, localId) as any;
    return row?.remote_id ?? undefined;
  }

  create(data: CreateMigrationState): MigrationState {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO migration_states (id, entity_type, local_id, status, attempt_count, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(id, data.entityType, data.localId, now, now);

    return {
      id,
      entityType: data.entityType,
      localId: data.localId,
      status: 'pending',
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  upsert(data: CreateMigrationState): MigrationState {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO migration_states (id, entity_type, local_id, status, attempt_count, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', 0, ?, ?)
         ON CONFLICT (entity_type, local_id) DO UPDATE SET updated_at = ?`,
      )
      .run(id, data.entityType, data.localId, now, now, now);

    const row = this.db
      .prepare('SELECT * FROM migration_states WHERE entity_type = ? AND local_id = ?')
      .get(data.entityType, data.localId) as any;
    return rowToState(row);
  }

  markMigrated(entityType: EntityType, localId: string, remoteId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE migration_states
         SET status = 'migrated', remote_id = ?, error_message = NULL, updated_at = ?
         WHERE entity_type = ? AND local_id = ?`,
      )
      .run(remoteId, now, entityType, localId);
  }

  markFailed(entityType: EntityType, localId: string, errorMessage: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE migration_states
         SET status = 'failed', error_message = ?, attempt_count = attempt_count + 1, updated_at = ?
         WHERE entity_type = ? AND local_id = ?`,
      )
      .run(errorMessage, now, entityType, localId);
  }

  markSkipped(entityType: EntityType, localId: string, reason: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE migration_states
         SET status = 'skipped', error_message = ?, updated_at = ?
         WHERE entity_type = ? AND local_id = ?`,
      )
      .run(reason, now, entityType, localId);
  }

  resetFailed(): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        "UPDATE migration_states SET status = 'pending', error_message = NULL, updated_at = ? WHERE status = 'failed'",
      )
      .run(now);
    return result.changes;
  }

  getStats(): MigrationStats {
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) as total,
          COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
          COALESCE(SUM(CASE WHEN status = 'migrated' THEN 1 ELSE 0 END), 0) as migrated,
          COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
          COALESCE(SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END), 0) as skipped
        FROM migration_states`,
      )
      .get() as any;

    return {
      total: row.total,
      pending: row.pending,
      migrated: row.migrated,
      failed: row.failed,
      skipped: row.skipped,
    };
  }

  clearAll(): number {
    const result = this.db.prepare('DELETE FROM migration_states').run();
    return result.changes;
  }
}
