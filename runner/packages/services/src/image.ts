/**
 * Image service
 * Translates: crates/services/src/services/image.rs
 *
 * Image storage and management service.
 */

export interface ImageMetadata {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  uploadedAt: string;
}

export class ImageService {
  // TODO: Implement image service
  async uploadImage(buffer: Buffer, filename: string): Promise<ImageMetadata> {
    throw new Error('Not implemented');
  }

  async getImage(id: string): Promise<Buffer> {
    throw new Error('Not implemented');
  }

  async deleteImage(id: string): Promise<void> {
    throw new Error('Not implemented');
  }
}
