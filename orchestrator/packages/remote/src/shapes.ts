/**
 * API response shapes
 * Translates: crates/remote/src/shapes.rs
 *
 * Standardized API response structures.
 */

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
}

// TODO: Add more response shapes
