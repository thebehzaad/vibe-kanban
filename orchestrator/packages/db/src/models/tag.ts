/**
 * Tag model
 * Translates: crates/db/src/models/tag.rs
 */

import * as crypto from 'node:crypto';
import type { DBService } from '../connection.js';

export interface Tag {
  id: string;
  name: string;
  color: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTag {
  name: string;
  color: string;
  description?: string;
}

export interface UpdateTag {
  name?: string;
  color?: string;
  description?: string;
}

export interface TagAssignment {
  id: string;
  tagId: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

interface TagRow {
  id: string;
  name: string;
  color: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class TagRepository {
  constructor(private db: DBService) {}

  /**
   * Find all tags
   */
  findAll(search?: string): Tag[] {
    let rows: TagRow[];

    if (search) {
      const searchLower = `%${search.toLowerCase()}%`;
      rows = this.db.database.prepare(`
        SELECT id, name, color, description, created_at, updated_at
        FROM tags
        WHERE LOWER(name) LIKE ? OR LOWER(description) LIKE ?
        ORDER BY name ASC
      `).all(searchLower, searchLower) as TagRow[];
    } else {
      rows = this.db.database.prepare(`
        SELECT id, name, color, description, created_at, updated_at
        FROM tags
        ORDER BY name ASC
      `).all() as TagRow[];
    }

    return rows.map(rowToTag);
  }

  /**
   * Find tag by ID
   */
  findById(id: string): Tag | undefined {
    const row = this.db.database.prepare(`
      SELECT id, name, color, description, created_at, updated_at
      FROM tags
      WHERE id = ?
    `).get(id) as TagRow | undefined;

    return row ? rowToTag(row) : undefined;
  }

  /**
   * Find tag by name
   */
  findByName(name: string): Tag | undefined {
    const row = this.db.database.prepare(`
      SELECT id, name, color, description, created_at, updated_at
      FROM tags
      WHERE LOWER(name) = LOWER(?)
    `).get(name) as TagRow | undefined;

    return row ? rowToTag(row) : undefined;
  }

  /**
   * Create a new tag
   */
  create(data: CreateTag, tagId?: string): Tag {
    const id = tagId ?? crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.database.prepare(`
      INSERT INTO tags (id, name, color, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.color, data.description ?? null, now, now);

    return this.findById(id)!;
  }

  /**
   * Update a tag
   */
  update(id: string, data: UpdateTag): Tag | undefined {
    const existing = this.findById(id);
    if (!existing) return undefined;

    const name = data.name ?? existing.name;
    const color = data.color ?? existing.color;
    const description = data.description ?? existing.description;
    const now = new Date().toISOString();

    this.db.database.prepare(`
      UPDATE tags SET name = ?, color = ?, description = ?, updated_at = ?
      WHERE id = ?
    `).run(name, color, description ?? null, now, id);

    return this.findById(id);
  }

  /**
   * Delete a tag
   */
  delete(id: string): number {
    const result = this.db.database.prepare(
      'DELETE FROM tags WHERE id = ?'
    ).run(id);
    return result.changes;
  }

  /**
   * Assign tag to entity
   */
  assignToEntity(tagId: string, entityType: string, entityId: string): void {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.database.prepare(`
      INSERT OR IGNORE INTO tag_assignments (id, tag_id, entity_type, entity_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, tagId, entityType, entityId, now);
  }

  /**
   * Remove tag from entity
   */
  removeFromEntity(tagId: string, entityType: string, entityId: string): void {
    this.db.database.prepare(`
      DELETE FROM tag_assignments
      WHERE tag_id = ? AND entity_type = ? AND entity_id = ?
    `).run(tagId, entityType, entityId);
  }

  /**
   * Get tags for entity
   */
  getTagsForEntity(entityType: string, entityId: string): Tag[] {
    const rows = this.db.database.prepare(`
      SELECT t.id, t.name, t.color, t.description, t.created_at, t.updated_at
      FROM tags t
      JOIN tag_assignments ta ON t.id = ta.tag_id
      WHERE ta.entity_type = ? AND ta.entity_id = ?
      ORDER BY t.name ASC
    `).all(entityType, entityId) as TagRow[];

    return rows.map(rowToTag);
  }
}
