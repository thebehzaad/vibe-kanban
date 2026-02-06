/**
 * Images routes
 * Translates: crates/server/src/routes/images.rs
 *
 * Rust pattern: State(deployment) → deployment.image() → ImageService methods
 * TS pattern:   fastify.deployment → deployment.db() → new ImageRepository(db)
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { ImageRepository } from '@orchestrator/db';

// Re-export DB types for consumers
export type { Image } from '@orchestrator/db';

// Types
export interface ImageMetadata {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
}

// Configuration
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml'
];

// Get images directory
function getImagesDir(): string {
  return process.env['ORCHESTRATOR_IMAGES_DIR'] ?? path.join(process.cwd(), 'data', 'images');
}

export const imageRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Ensure images directory exists
  const imagesDir = getImagesDir();
  await fs.mkdir(imagesDir, { recursive: true });

  const db = () => fastify.deployment.db();
  const getRepo = () => new ImageRepository(db());

  // POST /api/images/upload - Upload image (multipart)
  fastify.post('/images/upload', async (request, reply) => {
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const { filename, mimetype, file } = data;

    // Validate mime type
    if (!ALLOWED_MIME_TYPES.includes(mimetype)) {
      return reply.status(400).send({
        error: 'Invalid file type',
        allowed: ALLOWED_MIME_TYPES
      });
    }

    // Read file buffer
    const chunks: Buffer[] = [];
    let totalSize = 0;

    for await (const chunk of file) {
      totalSize += chunk.length;
      if (totalSize > MAX_FILE_SIZE) {
        return reply.status(400).send({
          error: 'File too large',
          maxSize: MAX_FILE_SIZE
        });
      }
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    const id = crypto.randomUUID();
    const ext = path.extname(filename) || getExtensionFromMime(mimetype);
    const storedFilename = `${id}${ext}`;
    const filePath = path.join(imagesDir, storedFilename);

    // Write file
    await fs.writeFile(filePath, buffer);

    const repo = getRepo();
    const image = repo.create({
      filename,
      mimeType: mimetype,
      size: buffer.length,
      path: filePath
    }, id);

    fastify.log.info(`Image uploaded: ${image.id} (${filename}, ${buffer.length} bytes)`);

    return {
      id: image.id,
      filename,
      mimeType: mimetype,
      size: buffer.length,
      url: `/api/images/${image.id}/file`
    };
  });

  // GET /api/images/:id/file - Serve image
  fastify.get<{ Params: { id: string } }>('/images/:id/file', async (request, reply) => {
    const { id } = request.params;
    const repo = getRepo();
    const image = repo.findById(id);

    if (!image) {
      return reply.status(404).send({ error: 'Image not found' });
    }

    try {
      const buffer = await fs.readFile(image.path);
      return reply
        .header('Content-Type', image.mimeType)
        .header('Content-Disposition', `inline; filename="${image.filename}"`)
        .header('Cache-Control', 'public, max-age=31536000') // 1 year cache
        .send(buffer);
    } catch {
      return reply.status(404).send({ error: 'Image file not found' });
    }
  });

  // DELETE /api/images/:id - Delete image
  fastify.delete<{ Params: { id: string } }>('/images/:id', async (request, reply) => {
    const { id } = request.params;
    const repo = getRepo();
    const image = repo.findById(id);

    if (!image) {
      return reply.status(404).send({ error: 'Image not found' });
    }

    // Delete file
    try {
      await fs.unlink(image.path);
    } catch {
      // File may already be deleted
    }

    repo.delete(id);

    fastify.log.info(`Image deleted: ${id}`);

    return reply.status(204).send();
  });

  // GET /api/images/task/:taskId - Get images for task
  fastify.get<{ Params: { taskId: string } }>('/images/task/:taskId', async (request) => {
    const { taskId } = request.params;
    const repo = getRepo();
    const taskImages = repo.findByTaskId(taskId);

    return {
      taskId,
      images: taskImages.map(img => ({
        id: img.id,
        filename: img.filename,
        mimeType: img.mimeType,
        size: img.size,
        url: `/api/images/${img.id}/file`,
        createdAt: img.createdAt
      })),
      total: taskImages.length
    };
  });

  // GET /api/images/task/:taskId/metadata - Get image metadata
  fastify.get<{ Params: { taskId: string }; Querystring: { path: string } }>(
    '/images/task/:taskId/metadata',
    async (request, reply) => {
      const { taskId } = request.params;
      const { path: imagePath } = request.query;

      // Find image by task ID and path
      const repo = getRepo();
      const taskImages = repo.findByTaskId(taskId);
      const image = taskImages.find(img => img.filename === imagePath);

      if (!image) {
        return reply.status(404).send({ error: 'Image not found' });
      }

      const metadata: ImageMetadata = {
        id: image.id,
        filename: image.filename,
        mimeType: image.mimeType,
        size: image.size
        // TODO: Get actual image dimensions
      };

      return metadata;
    }
  );

  // POST /api/images/task/:taskId/upload - Upload image for task
  fastify.post<{ Params: { taskId: string } }>(
    '/images/task/:taskId/upload',
    async (request, reply) => {
      const { taskId } = request.params;
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      const { filename, mimetype, file } = data;

      // Validate mime type
      if (!ALLOWED_MIME_TYPES.includes(mimetype)) {
        return reply.status(400).send({
          error: 'Invalid file type',
          allowed: ALLOWED_MIME_TYPES
        });
      }

      // Read file buffer
      const chunks: Buffer[] = [];
      let totalSize = 0;

      for await (const chunk of file) {
        totalSize += chunk.length;
        if (totalSize > MAX_FILE_SIZE) {
          return reply.status(400).send({
            error: 'File too large',
            maxSize: MAX_FILE_SIZE
          });
        }
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      const id = crypto.randomUUID();
      const ext = path.extname(filename) || getExtensionFromMime(mimetype);
      const storedFilename = `${id}${ext}`;
      const filePath = path.join(imagesDir, storedFilename);

      // Write file
      await fs.writeFile(filePath, buffer);

      const repo = getRepo();
      const image = repo.create({
        taskId,
        filename,
        mimeType: mimetype,
        size: buffer.length,
        path: filePath
      }, id);

      fastify.log.info(`Image uploaded for task ${taskId}: ${image.id} (${filename})`);

      return {
        id: image.id,
        taskId,
        filename,
        mimeType: mimetype,
        size: buffer.length,
        url: `/api/images/${image.id}/file`
      };
    }
  );
};

// Helper functions
function getExtensionFromMime(mimeType: string): string {
  const extensions: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg'
  };
  return extensions[mimeType] ?? '.bin';
}
