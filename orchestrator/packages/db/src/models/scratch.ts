/**
 * Scratch model
 * Translates: crates/db/src/models/scratch.rs
 */

import * as crypto from 'node:crypto';
import type { DBService } from '../connection.js';

export type ScratchType =
  | 'note'
  | 'snippet'
  | 'todo'
  | 'bookmark'
  | 'preference'
  | 'ui_state'
  | 'custom';

export interface ScratchItem {
  id: string;
  type: ScratchType;
  key: string;
  value: unknown;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScratchItem {
  type: ScratchType;
  key: string;
  value: unknown;
  metadata?: Record<string, unknown>;
}

export interface UpdateScratchItem {
  value: unknown;
  metadata?: Record<string, unknown>;
}

interface ScratchRow {
  id: string;
  type: string;
  key: string;
  value: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

function rowToScratchItem(row: ScratchRow): ScratchItem {
  return {
    id: row.id,
    type: row.type as ScratchType,
    key: row.key,
    value: JSON.parse(row.value),
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class ScratchRepository {
  constructor(private db: DBService) {}

  /**
   * Find all scratch items, optionally filtered by type
   */
  findAll(type?: ScratchType): ScratchItem[] {
    let rows: ScratchRow[];

    if (type) {
      rows = this.db.database.prepare(`
        SELECT id, type, key, value, metadata, created_at, updated_at
        FROM scratch
        WHERE type = ?
        ORDER BY updated_at DESC
      `).all(type) as ScratchRow[];
    } else {
      rows = this.db.database.prepare(`
        SELECT id, type, key, value, metadata, created_at, updated_at
        FROM scratch
        ORDER BY updated_at DESC
      `).all() as ScratchRow[];
    }

    return rows.map(rowToScratchItem);
  }

  /**
   * Find scratch item by type and key
   */
  findByTypeAndKey(type: string, key: string): ScratchItem | undefined {
    const row = this.db.database.prepare(`
      SELECT id, type, key, value, metadata, created_at, updated_at
      FROM scratch
      WHERE type = ? AND key = ?
    `).get(type, key) as ScratchRow | undefined;

    return row ? rowToScratchItem(row) : undefined;
  }

  /**
   * Find scratch item by ID
   */
  findById(id: string): ScratchItem | undefined {
    const row = this.db.database.prepare(`
      SELECT id, type, key, value, metadata, created_at, updated_at
      FROM scratch
      WHERE id = ?
    `).get(id) as ScratchRow | undefined;

    return row ? rowToScratchItem(row) : undefined;
  }

  /**
   * Create a new scratch item
   */
  create(data: CreateScratchItem, itemId?: string): ScratchItem {
    const id = itemId ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const valueJson = JSON.stringify(data.value);
    const metadataJson = data.metadata ? JSON.stringify(data.metadata) : null;

    this.db.database.prepare(`
      INSERT INTO scratch (id, type, key, value, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.type, data.key, valueJson, metadataJson, now, now);

    return this.findById(id)!;
  }

  /**
   * Update or insert a scratch item (upsert)
   */
  upsert(type: string, key: string, value: unknown, metadata?: Record<string, unknown>): ScratchItem {
    const existing = this.findByTypeAndKey(type, key);
    const now = new Date().toISOString();
    const valueJson = JSON.stringify(value);
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    if (existing) {
      this.db.database.prepare(`
        UPDATE scratch SET value = ?, metadata = ?, updated_at = ?
        WHERE type = ? AND key = ?
      `).run(valueJson, metadataJson, now, type, key);
      return this.findByTypeAndKey(type, key)!;
    } else {
      const id = crypto.randomUUID();
      this.db.database.prepare(`
        INSERT INTO scratch (id, type, key, value, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, type, key, valueJson, metadataJson, now, now);
      return this.findById(id)!;
    }
  }

  /**
   * Update a scratch item
   */
  update(type: string, key: string, data: UpdateScratchItem): ScratchItem | undefined {
    const existing = this.findByTypeAndKey(type, key);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const valueJson = JSON.stringify(data.value);
    const metadataJson = data.metadata
      ? JSON.stringify(data.metadata)
      : (existing.metadata ? JSON.stringify(existing.metadata) : null);

    this.db.database.prepare(`
      UPDATE scratch SET value = ?, metadata = ?, updated_at = ?
      WHERE type = ? AND key = ?
    `).run(valueJson, metadataJson, now, type, key);

    return this.findByTypeAndKey(type, key);
  }

  /**
   * Delete a scratch item
   */
  delete(type: string, key: string): number {
    const result = this.db.database.prepare(
      'DELETE FROM scratch WHERE type = ? AND key = ?'
    ).run(type, key);
    return result.changes;
  }

  /**
   * Delete by ID
   */
  deleteById(id: string): number {
    const result = this.db.database.prepare(
      'DELETE FROM scratch WHERE id = ?'
    ).run(id);
    return result.changes;
  }
}
