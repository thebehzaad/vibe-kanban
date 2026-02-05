/**
 * Images routes
 * Translates: crates/server/src/routes/images.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

// Types
export interface Image {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  taskId?: string;
  workspaceId?: string;
  path: string;
  createdAt: string;
}

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

// In-memory store (replace with database)
const images = new Map<string, Image>();

// Get images directory
function getImagesDir(): string {
  return process.env['ORCHESTRATOR_IMAGES_DIR'] ?? path.join(process.cwd(), 'data', 'images');
}

export const imageRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Ensure images directory exists
  const imagesDir = getImagesDir();
  await fs.mkdir(imagesDir, { recursive: true });

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

    const image: Image = {
      id,
      filename,
      mimeType: mimetype,
      size: buffer.length,
      path: filePath,
      createdAt: new Date().toISOString()
    };

    images.set(id, image);

    fastify.log.info(`Image uploaded: ${id} (${filename}, ${buffer.length} bytes)`);

    return {
      id,
      filename,
      mimeType: mimetype,
      size: buffer.length,
      url: `/api/images/${id}/file`
    };
  });

  // GET /api/images/:id/file - Serve image
  fastify.get<{ Params: { id: string } }>('/images/:id/file', async (request, reply) => {
    const { id } = request.params;
    const image = images.get(id);

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
    const image = images.get(id);

    if (!image) {
      return reply.status(404).send({ error: 'Image not found' });
    }

    // Delete file
    try {
      await fs.unlink(image.path);
    } catch {
      // File may already be deleted
    }

    images.delete(id);

    fastify.log.info(`Image deleted: ${id}`);

    return reply.status(204).send();
  });

  // GET /api/images/task/:taskId - Get images for task
  fastify.get<{ Params: { taskId: string } }>('/images/task/:taskId', async (request) => {
    const { taskId } = request.params;

    const taskImages = Array.from(images.values())
      .filter(img => img.taskId === taskId);

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
      const image = Array.from(images.values())
        .find(img => img.taskId === taskId && img.filename === imagePath);

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

      const image: Image = {
        id,
        filename,
        mimeType: mimetype,
        size: buffer.length,
        taskId,
        path: filePath,
        createdAt: new Date().toISOString()
      };

      images.set(id, image);

      fastify.log.info(`Image uploaded for task ${taskId}: ${id} (${filename})`);

      return {
        id,
        taskId,
        filename,
        mimeType: mimetype,
        size: buffer.length,
        url: `/api/images/${id}/file`
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

// Export helpers
export function getImage(id: string): Image | undefined {
  return images.get(id);
}

export function storeImage(image: Image): void {
  images.set(image.id, image);
}
