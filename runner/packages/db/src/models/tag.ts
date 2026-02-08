/**
 * Tag model
 * Translates: crates/db/src/models/tag.rs
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseType } from '../connection.js';

// --- Types ---

export interface Tag {
  id: string;
  tagName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTag {
  tagName: string;
  content: string;
}

export interface UpdateTag {
  tagName?: string;
  content?: string;
}

// --- Row mapping ---

interface TagRow {
  id: string;
  tag_name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

function rowToTag(row: TagRow): Tag {
  return {
    id: row.id,
    tagName: row.tag_name,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Repository ---

export class TagRepository {
  constructor(private db: DatabaseType) {}

  findAll(): Tag[] {
    const rows = this.db.prepare(`
      SELECT id, tag_name, content, created_at, updated_at
      FROM tags
      ORDER BY tag_name ASC
    `).all() as TagRow[];

    return rows.map(rowToTag);
  }

  findById(id: string): Tag | undefined {
    const row = this.db.prepare(`
      SELECT id, tag_name, content, created_at, updated_at
      FROM tags
      WHERE id = ?
    `).get(id) as TagRow | undefined;

    return row ? rowToTag(row) : undefined;
  }

  create(data: CreateTag): Tag {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO tags (id, tag_name, content)
      VALUES (?, ?, ?)
    `).run(id, data.tagName, data.content);

    return this.findById(id)!;
  }

  update(id: string, data: UpdateTag): Tag | undefined {
    const existing = this.findById(id);
    if (!existing) return undefined;

    const tagName = data.tagName ?? existing.tagName;
    const content = data.content ?? existing.content;
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE tags
      SET tag_name = ?, content = ?, updated_at = ?
      WHERE id = ?
    `).run(tagName, content, now, id);

    return this.findById(id);
  }

  delete(id: string): number {
    const result = this.db.prepare(
      'DELETE FROM tags WHERE id = ?',
    ).run(id);
    return result.changes;
  }
}
