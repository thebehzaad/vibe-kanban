/**
 * Image model
 * Translates: crates/db/src/models/image.rs
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseType } from '../connection.js';

// --- Types ---

export interface Image {
  id: string;
  filePath: string;
  originalName: string;
  mimeType?: string;
  sizeBytes: number;
  hash: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateImage {
  filePath: string;
  originalName: string;
  mimeType?: string;
  sizeBytes: number;
  hash: string;
}

export interface TaskImage {
  id: string;
  taskId: string;
  imageId: string;
  createdAt: string;
}

export interface CreateTaskImage {
  taskId: string;
  imageId: string;
}

// --- Row mapping ---

interface ImageRow {
  id: string;
  file_path: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  hash: string;
  created_at: string;
  updated_at: string;
}

function rowToImage(row: ImageRow): Image {
  return {
    id: row.id,
    filePath: row.file_path,
    originalName: row.original_name,
    mimeType: row.mime_type ?? undefined,
    sizeBytes: row.size_bytes,
    hash: row.hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface TaskImageRow {
  id: string;
  task_id: string;
  image_id: string;
  created_at: string;
}

function rowToTaskImage(row: TaskImageRow): TaskImage {
  return {
    id: row.id,
    taskId: row.task_id,
    imageId: row.image_id,
    createdAt: row.created_at,
  };
}

// --- Image Repository ---

export class ImageRepository {
  constructor(private db: DatabaseType) {}

  create(data: CreateImage): Image {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO images (id, file_path, original_name, mime_type, size_bytes, hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, data.filePath, data.originalName, data.mimeType ?? null, data.sizeBytes, data.hash);

    return this.findById(id)!;
  }

  findByHash(hash: string): Image | undefined {
    const row = this.db.prepare(`
      SELECT id, file_path, original_name, mime_type, size_bytes, hash, created_at, updated_at
      FROM images
      WHERE hash = ?
    `).get(hash) as ImageRow | undefined;

    return row ? rowToImage(row) : undefined;
  }

  findById(id: string): Image | undefined {
    const row = this.db.prepare(`
      SELECT id, file_path, original_name, mime_type, size_bytes, hash, created_at, updated_at
      FROM images
      WHERE id = ?
    `).get(id) as ImageRow | undefined;

    return row ? rowToImage(row) : undefined;
  }

  findByFilePath(filePath: string): Image | undefined {
    const row = this.db.prepare(`
      SELECT id, file_path, original_name, mime_type, size_bytes, hash, created_at, updated_at
      FROM images
      WHERE file_path = ?
    `).get(filePath) as ImageRow | undefined;

    return row ? rowToImage(row) : undefined;
  }

  findByTaskId(taskId: string): Image[] {
    const rows = this.db.prepare(`
      SELECT i.id, i.file_path, i.original_name, i.mime_type, i.size_bytes, i.hash,
             i.created_at, i.updated_at
      FROM images i
      JOIN task_images ti ON i.id = ti.image_id
      WHERE ti.task_id = ?
      ORDER BY ti.created_at
    `).all(taskId) as ImageRow[];

    return rows.map(rowToImage);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM images WHERE id = ?').run(id);
  }

  findOrphanedImages(): Image[] {
    const rows = this.db.prepare(`
      SELECT i.id, i.file_path, i.original_name, i.mime_type, i.size_bytes, i.hash,
             i.created_at, i.updated_at
      FROM images i
      LEFT JOIN task_images ti ON i.id = ti.image_id
      WHERE ti.task_id IS NULL
    `).all() as ImageRow[];

    return rows.map(rowToImage);
  }
}

// --- TaskImage Repository ---

export class TaskImageRepository {
  constructor(private db: DatabaseType) {}

  /**
   * Associate multiple images with a task, skipping duplicates.
   */
  associateManyDedup(taskId: string, imageIds: string[]): void {
    for (const imageId of imageIds) {
      const id = randomUUID();
      this.db.prepare(`
        INSERT INTO task_images (id, task_id, image_id)
        SELECT ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM task_images WHERE task_id = ? AND image_id = ?
        )
      `).run(id, taskId, imageId, taskId, imageId);
    }
  }

  deleteByTaskId(taskId: string): void {
    this.db.prepare('DELETE FROM task_images WHERE task_id = ?').run(taskId);
  }

  isAssociated(taskId: string, imageId: string): boolean {
    const row = this.db.prepare(`
      SELECT EXISTS(
        SELECT 1 FROM task_images WHERE task_id = ? AND image_id = ?
      ) as "exists"
    `).get(taskId, imageId) as { exists: number };
    return row.exists !== 0;
  }
}
