/**
 * API response utilities
 * Translates: crates/utils/src/response.rs
 *
 * Standard API response formatting.
 */

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export function successResponse<T>(data: T, message?: string): ApiResponse<T> {
  return {
    success: true,
    data,
    message
  };
}

export function errorResponse(error: string): ApiResponse<never> {
  return {
    success: false,
    error
  };
}

export function messageResponse(message: string): ApiResponse<never> {
  return {
    success: true,
    message
  };
}
