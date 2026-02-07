/**
 * Sentry error tracking utilities
 * Translates: crates/utils/src/sentry.rs
 *
 * Sentry integration for error tracking.
 */

export enum SentrySource {
  Backend = 'backend',
  Frontend = 'frontend',
  Extension = 'extension'
}

export interface SentryOptions {
  dsn?: string;
  environment?: string;
  release?: string;
  source: SentrySource;
}

export function initSentry(options: SentryOptions): void {
  // TODO: Implement Sentry initialization
  // In Rust, this uses the sentry crate
}

export function captureException(error: Error, context?: Record<string, unknown>): void {
  // TODO: Implement Sentry error capture
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error'): void {
  // TODO: Implement Sentry message capture
}

export function setUser(userId: string, email?: string): void {
  // TODO: Implement Sentry user context
}

export function addBreadcrumb(message: string, category?: string, data?: Record<string, unknown>): void {
  // TODO: Implement Sentry breadcrumb
}
