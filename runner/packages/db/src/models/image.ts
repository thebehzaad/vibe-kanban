/**
 * Image model
 * Translates: crates/db/src/models/image.rs
 */

import * as crypto from 'node:crypto';
import type { DBService } from '../connection.js';

export interface Image {
  id: string;
  taskId?: string;
  filename: string;
  mimeType: string;
  size: number;
  path: string;
  createdAt: string;
}

export interface CreateImage {
  taskId?: string;
  filename: string;
  mimeType: string;
  size: number;
  path: string;
}

interface ImageRow {
  id: string;
  task_id: string | null;
  filename: string;
  mime_type: string;
  size: number;
  path: string;
  created_at: string;
}

function rowToImage(row: ImageRow): Image {
  return {
    id: row.id,
    taskId: row.task_id ?? undefined,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
    path: row.path,
    createdAt: row.created_at
  };
}

export class ImageRepository {
  constructor(private db: DBService) {}

  /**
   * Find image by ID
   */
  findById(id: string): Image | undefined {
    const row = this.db.database.prepare(`
      SELECT id, task_id, filename, mime_type, size, path, created_at
      FROM images
      WHERE id = ?
    `).get(id) as ImageRow | undefined;

    return row ? rowToImage(row) : undefined;
  }

  /**
   * Find images by task ID
   */
  findByTaskId(taskId: string): Image[] {
    const rows = this.db.database.prepare(`
      SELECT id, task_id, filename, mime_type, size, path, created_at
      FROM images
      WHERE task_id = ?
      ORDER BY created_at DESC
    `).all(taskId) as ImageRow[];

    return rows.map(rowToImage);
  }

  /**
   * Create a new image
   */
  create(data: CreateImage, imageId?: string): Image {
    const id = imageId ?? crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.database.prepare(`
      INSERT INTO images (id, task_id, filename, mime_type, size, path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.taskId ?? null, data.filename, data.mimeType, data.size, data.path, now);

    return this.findById(id)!;
  }

  /**
   * Delete an image
   */
  delete(id: string): number {
    const result = this.db.database.prepare(
      'DELETE FROM images WHERE id = ?'
    ).run(id);
    return result.changes;
  }
}
