/**
 * Error handling
 * Translates: crates/server/src/error.rs
 *
 * API error types and error response formatting.
 */

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, message, details);
  }

  static unauthorized(message: string = 'Unauthorized'): ApiError {
    return new ApiError(401, message);
  }

  static forbidden(message: string = 'Forbidden'): ApiError {
    return new ApiError(403, message);
  }

  static notFound(message: string = 'Not found'): ApiError {
    return new ApiError(404, message);
  }

  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError(409, message, details);
  }

  static internalError(message: string = 'Internal server error', details?: unknown): ApiError {
    return new ApiError(500, message, details);
  }
}

export interface ErrorResponse {
  error: string;
  details?: unknown;
  timestamp: string;
}

export function formatErrorResponse(error: unknown): ErrorResponse {
  const timestamp = new Date().toISOString();

  if (error instanceof ApiError) {
    return {
      error: error.message,
      details: error.details,
      timestamp
    };
  }

  if (error instanceof Error) {
    return {
      error: error.message,
      timestamp
    };
  }

  return {
    error: String(error),
    timestamp
  };
}
