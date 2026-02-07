/**
 * Review error types
 * Translates: crates/review/src/error.rs
 *
 * Error types for review operations.
 */

export class ReviewError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'ReviewError';
  }

  static notFound(message: string): ReviewError {
    return new ReviewError(message, 'NOT_FOUND');
  }

  static apiError(message: string): ReviewError {
    return new ReviewError(message, 'API_ERROR');
  }

  static configError(message: string): ReviewError {
    return new ReviewError(message, 'CONFIG_ERROR');
  }
}
