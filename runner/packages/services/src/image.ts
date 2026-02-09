/**
 * Image service
 * Translates: crates/services/src/services/image.rs
 *
 * Image storage with SHA256 dedup, cache directory management,
 * and worktree copy support.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import type { DatabaseType } from '@runner/db';
import { ImageRepository, type Image, type CreateImage } from '@runner/db';
import { getCacheDir, VIBE_IMAGES_DIR } from '@runner/utils';

// ── Error ──

export type ImageErrorCode =
  | 'io'
  | 'database'
  | 'invalid_format'
  | 'too_large'
  | 'not_found'
  | 'response_build_error';

export class ImageError extends Error {
  readonly code: ImageErrorCode;

  constructor(code: ImageErrorCode, message: string) {
    super(message);
    this.name = 'ImageError';
    this.code = code;
  }

  static io(err: Error): ImageError {
    return new ImageError('io', `IO error: ${err.message}`);
  }

  static database(err: Error): ImageError {
    return new ImageError('database', `Database error: ${err.message}`);
  }

  static invalidFormat(): ImageError {
    return new ImageError('invalid_format', 'Invalid image format');
  }

  static tooLarge(size: number, maxSize: number): ImageError {
    return new ImageError('too_large', `Image too large: ${size} bytes (max: ${maxSize} bytes)`);
  }

  static notFound(): ImageError {
    return new ImageError('not_found', 'Image not found');
  }

  static responseBuildError(msg: string): ImageError {
    return new ImageError('response_build_error', `Failed to build response: ${msg}`);
  }
}

// ── Helpers ──

/**
 * Sanitize filename for filesystem safety:
 * - Lowercase
 * - Spaces → underscores
 * - Remove special characters (keep alphanumeric and underscores)
 * - Truncate if too long
 */
function sanitizeFilename(name: string): string {
  const stem = path.parse(name).name || 'image';

  let clean = stem
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  const maxLen = 50;
  if (clean.length > maxLen) {
    clean = clean.substring(0, maxLen);
  } else if (clean.length === 0) {
    clean = 'image';
  }

  return clean;
}

// ── ImageService ──

export class ImageService {
  private cacheDir: string;
  private db: DatabaseType;
  private maxSizeBytes: number;

  constructor(db: DatabaseType) {
    this.cacheDir = path.join(getCacheDir(), 'images');
    this.db = db;
    this.maxSizeBytes = 20 * 1024 * 1024; // 20MB default

    // Ensure cache directory exists
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  storeImage(data: Buffer, originalFilename: string): Image {
    const fileSize = data.length;

    if (fileSize > this.maxSizeBytes) {
      throw ImageError.tooLarge(fileSize, this.maxSizeBytes);
    }

    const hash = createHash('sha256').update(data).digest('hex');

    // Extract extension from original filename
    const extension = path.extname(originalFilename).replace('.', '').toLowerCase() || 'png';

    const mimeType = (() => {
      switch (extension) {
        case 'png': return 'image/png';
        case 'jpg': case 'jpeg': return 'image/jpeg';
        case 'gif': return 'image/gif';
        case 'webp': return 'image/webp';
        case 'bmp': return 'image/bmp';
        case 'svg': return 'image/svg+xml';
        default: return undefined;
      }
    })();

    if (!mimeType) {
      throw ImageError.invalidFormat();
    }

    const imageRepo = new ImageRepository(this.db);

    // Check for existing image with same hash (dedup)
    const existing = imageRepo.findByHash(hash);
    if (existing) {
      console.debug(`Reusing existing image record with hash ${hash}`);
      return existing;
    }

    const cleanName = sanitizeFilename(originalFilename);
    const newFilename = `${crypto.randomUUID()}_${cleanName}.${extension}`;
    const cachedPath = path.join(this.cacheDir, newFilename);
    fs.writeFileSync(cachedPath, data);

    const createData: CreateImage = {
      filePath: newFilename,
      originalName: originalFilename,
      mimeType,
      sizeBytes: fileSize,
      hash,
    };

    return imageRepo.create(createData);
  }

  deleteOrphanedImages(): void {
    const imageRepo = new ImageRepository(this.db);
    const orphanedImages = imageRepo.findOrphanedImages();

    if (orphanedImages.length === 0) {
      console.debug('No orphaned images found during cleanup');
      return;
    }

    console.debug(`Found ${orphanedImages.length} orphaned images to clean up`);
    let deletedCount = 0;
    let failedCount = 0;

    for (const image of orphanedImages) {
      try {
        this.deleteImage(image.id);
        deletedCount++;
        console.debug(`Deleted orphaned image: ${image.id}`);
      } catch (e) {
        failedCount++;
        console.error(`Failed to delete orphaned image ${image.id}: ${e}`);
      }
    }

    console.log(
      `Image cleanup completed: ${deletedCount} deleted, ${failedCount} failed`,
    );
  }

  getAbsolutePath(image: Image): string {
    return path.join(this.cacheDir, image.filePath);
  }

  getImage(id: string): Image | undefined {
    const imageRepo = new ImageRepository(this.db);
    return imageRepo.findById(id);
  }

  deleteImage(id: string): void {
    const imageRepo = new ImageRepository(this.db);
    const image = imageRepo.findById(id);

    if (image) {
      const filePath = path.join(this.cacheDir, image.filePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      imageRepo.delete(id);
    }
  }

  copyImagesByTaskToWorktree(
    worktreePath: string,
    taskId: string,
    agentWorkingDir?: string,
  ): void {
    const imageRepo = new ImageRepository(this.db);
    const images = imageRepo.findByTaskId(taskId);

    // When agent_working_dir is set, copy images to that subdirectory
    // so relative paths like .vibe-images/xxx.png work correctly
    const targetPath = agentWorkingDir
      ? path.join(worktreePath, agentWorkingDir)
      : worktreePath;

    this.copyImages(targetPath, images);
  }

  copyImagesByIdsToWorktree(
    worktreePath: string,
    imageIds: string[],
  ): void {
    const imageRepo = new ImageRepository(this.db);
    const images: Image[] = [];

    for (const id of imageIds) {
      const image = imageRepo.findById(id);
      if (image) {
        images.push(image);
      }
    }

    this.copyImages(worktreePath, images);
  }

  /** Copy images to the worktree. Skips images that already exist at target. */
  private copyImages(worktreePath: string, images: Image[]): void {
    if (images.length === 0) {
      return;
    }

    const imagesDir = path.join(worktreePath, VIBE_IMAGES_DIR);

    // Fast path: check if all images exist before doing anything
    const allExist = images.every((image) =>
      fs.existsSync(path.join(imagesDir, image.filePath)),
    );
    if (allExist) {
      return;
    }

    fs.mkdirSync(imagesDir, { recursive: true });

    // Create .gitignore to ignore all files in this directory
    const gitignorePath = path.join(imagesDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '*\n');
    }

    for (const image of images) {
      const src = path.join(this.cacheDir, image.filePath);
      const dst = path.join(imagesDir, image.filePath);

      if (fs.existsSync(dst)) {
        continue;
      }

      if (fs.existsSync(src)) {
        try {
          fs.copyFileSync(src, dst);
          console.debug(`Copied ${image.filePath}`);
        } catch (e) {
          console.error(`Failed to copy ${image.filePath}: ${e}`);
        }
      } else {
        console.warn(`Missing cache file: ${src}`);
      }
    }
  }
}
