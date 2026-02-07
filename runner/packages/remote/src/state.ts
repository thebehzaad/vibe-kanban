/**
 * Application state
 * Translates: crates/remote/src/state.rs
 *
 * Remote server application state.
 */

import type { Pool } from 'pg';
import type { R2StorageService } from './r2.js';
import type { MailService } from './mail.js';
import type { BillingService } from './billing.js';

export interface AppState {
  db: Pool;
  storage: R2StorageService;
  mail: MailService;
  billing?: BillingService;
  jwtSecret: string;
  githubOAuth?: {
    clientId: string;
    clientSecret: string;
  };
  googleOAuth?: {
    clientId: string;
    clientSecret: string;
  };
}

export function createAppState(config: {
  databaseUrl: string;
  jwtSecret: string;
  r2Config: { accountId: string; accessKeyId: string; secretAccessKey: string; bucketName: string };
  githubOAuth?: { clientId: string; clientSecret: string };
  googleOAuth?: { clientId: string; clientSecret: string };
}): AppState {
  // TODO: Initialize app state
  throw new Error('Not implemented');
}
