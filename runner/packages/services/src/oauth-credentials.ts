/**
 * OAuth credentials service
 * Translates: crates/services/src/services/oauth_credentials.rs
 *
 * Service for managing OAuth credentials (JWT tokens) in memory and persistent storage.
 * The token is loaded into memory on startup and persisted to disk on save.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

// ── Credentials ──

/**
 * OAuth credentials containing the JWT tokens issued by the remote OAuth service.
 * The `accessToken` is short-lived; `refreshToken` allows minting a new pair.
 */
export interface Credentials {
  accessToken?: string;
  refreshToken: string;
  expiresAt?: Date;
}

/**
 * Check whether the access token is missing or about to expire.
 * @param creds  The credentials to check
 * @param leewayMs  Leeway in milliseconds before actual expiry (default 0)
 */
export function expiresSoon(creds: Credentials, leewayMs: number = 0): boolean {
  if (creds.accessToken != null && creds.expiresAt != null) {
    return Date.now() + leewayMs >= creds.expiresAt.getTime();
  }
  return true;
}

// ── StoredCredentials (private, persisted shape) ──

interface StoredCredentials {
  refreshToken: string;
}

function storedToCredentials(stored: StoredCredentials): Credentials {
  return {
    accessToken: undefined,
    refreshToken: stored.refreshToken,
    expiresAt: undefined,
  };
}

// ── OAuthCredentials service ──

export class OAuthCredentials {
  private path: string;
  private inner: Credentials | null;

  constructor(credPath: string) {
    this.path = credPath;
    this.inner = null;
  }

  async load(): Promise<void> {
    const stored = await this.loadFromFile();
    this.inner = stored != null ? storedToCredentials(stored) : null;
  }

  async save(creds: Credentials): Promise<void> {
    const stored: StoredCredentials = {
      refreshToken: creds.refreshToken,
    };
    await this.saveToFile(stored);
    this.inner = { ...creds };
  }

  async clear(): Promise<void> {
    try {
      fs.unlinkSync(this.path);
    } catch {
      // ignore – file may not exist
    }
    this.inner = null;
  }

  async get(): Promise<Credentials | null> {
    return this.inner != null ? { ...this.inner } : null;
  }

  // ── Private helpers ──

  private async loadFromFile(): Promise<StoredCredentials | null> {
    if (!fs.existsSync(this.path)) {
      return null;
    }

    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(this.path);
    } catch {
      return null;
    }

    try {
      const parsed = JSON.parse(bytes.toString('utf-8')) as StoredCredentials;
      // Validate that the required field exists
      if (typeof parsed.refreshToken !== 'string') {
        throw new Error('missing refreshToken');
      }
      return parsed;
    } catch (e) {
      console.warn('failed to parse credentials file, renaming to .bad:', e);
      const bad = this.path.replace(/(\.[^.]+)?$/, '.bad');
      try {
        fs.renameSync(this.path, bad);
      } catch {
        // ignore rename failures
      }
      return null;
    }
  }

  private async saveToFile(creds: StoredCredentials): Promise<void> {
    const tmp = this.path.replace(/(\.[^.]+)?$/, '.tmp');

    // Ensure parent directory exists
    const dir = path.dirname(tmp);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write to tmp file
    const content = JSON.stringify(creds, null, 2);
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeFileSync(fd, content, 'utf-8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    // Atomic rename
    fs.renameSync(tmp, this.path);
  }
}
