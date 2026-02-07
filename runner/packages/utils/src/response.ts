/**
 * API response utilities
 * Translates: crates/utils/src/response.rs
 */

export interface ApiResponse<T, E = T> {
  success: boolean;
  data?: T;
  errorData?: E;
  message?: string;
}

/** Creates a successful response with data and no message. */
export function successResponse<T, E = T>(data: T): ApiResponse<T, E> {
  return {
    success: true,
    data,
  };
}

/** Creates an error response with message and no data. */
export function errorResponse<T, E = T>(message: string): ApiResponse<T, E> {
  return {
    success: false,
    message,
  };
}

/** Creates an error response with error data but no message. */
export function errorWithData<T, E = T>(data: E): ApiResponse<T, E> {
  return {
    success: false,
    errorData: data,
  };
}
