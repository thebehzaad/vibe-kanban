/**
 * Authentication context
 * Translates: crates/services/src/services/auth.rs
 *
 * Wraps OAuthCredentials with profile caching and refresh locking.
 */

import type { API } from '@runner/utils';

import { OAuthCredentials, type Credentials } from './oauth-credentials.js';

// ── AuthContext ──

export class AuthContext {
  private oauth: OAuthCredentials;
  private profile: API.ProfileResponse | null;
  private refreshLockPromise: Promise<void> | null;

  constructor(
    oauth: OAuthCredentials,
    profile: API.ProfileResponse | null = null,
  ) {
    this.oauth = oauth;
    this.profile = profile;
    this.refreshLockPromise = null;
  }

  async getCredentials(): Promise<Credentials | null> {
    return this.oauth.get();
  }

  async saveCredentials(creds: Credentials): Promise<void> {
    await this.oauth.save(creds);
  }

  async clearCredentials(): Promise<void> {
    await this.oauth.clear();
  }

  cachedProfile(): API.ProfileResponse | null {
    return this.profile;
  }

  setProfile(profile: API.ProfileResponse): void {
    this.profile = profile;
  }

  clearProfile(): void {
    this.profile = null;
  }

  /**
   * Acquire a refresh guard. In Rust this uses a Tokio Mutex for
   * cross-task serialization; here we use a simple promise-based lock
   * to serialize concurrent refresh attempts within the same process.
   */
  async refreshGuard(): Promise<() => void> {
    // Wait for any in-progress refresh
    while (this.refreshLockPromise) {
      await this.refreshLockPromise;
    }

    // Set up lock
    let releaseFn: () => void;
    this.refreshLockPromise = new Promise<void>((resolve) => {
      releaseFn = () => {
        this.refreshLockPromise = null;
        resolve();
      };
    });

    return releaseFn!;
  }
}
