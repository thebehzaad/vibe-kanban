/**
 * Sentry error tracking utilities
 * Translates: crates/utils/src/sentry.rs
 */

export enum SentrySource {
  Backend = 'backend',
  Mcp = 'mcp',
  Remote = 'remote',
}

const SENTRY_DSN_DEFAULT =
  'https://1065a1d276a581316999a07d5dffee26@o4509603705192449.ingest.de.sentry.io/4509605576441937';
const SENTRY_DSN_REMOTE =
  'https://d6e4c45af2b081fadb10fb0ba726ccaf@o4509603705192449.ingest.de.sentry.io/4510305669283920';

function getDsn(source: SentrySource): string {
  return source === SentrySource.Remote ? SENTRY_DSN_REMOTE : SENTRY_DSN_DEFAULT;
}

function getEnvironment(): string {
  return process.env.NODE_ENV === 'production' ? 'production' : 'dev';
}

let initialized = false;

/** Initialize Sentry once with source-specific configuration. Safe to call multiple times. */
export function initOnce(source: SentrySource): void {
  if (initialized) return;
  initialized = true;

  // TODO: Integrate @sentry/node when ready
  const _dsn = getDsn(source);
  const _env = getEnvironment();
  const _tag = source;
}

/** Configure Sentry user context for error tracking. */
export function configureUserScope(
  userId: string,
  username?: string,
  email?: string,
): void {
  // TODO: Integrate @sentry/node when ready
  void userId;
  void username;
  void email;
}
