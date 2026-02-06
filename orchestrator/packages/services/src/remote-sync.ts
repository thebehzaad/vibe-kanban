/**
 * Remote sync service
 * Translates: crates/services/src/services/remote_sync.rs
 *
 * Synchronizes data with remote instances.
 */

export interface SyncStatus {
  lastSyncAt?: string;
  inProgress: boolean;
  error?: string;
}

export class RemoteSyncService {
  // TODO: Implement remote sync
  async startSync(): Promise<void> {
    throw new Error('Not implemented');
  }

  async getSyncStatus(): Promise<SyncStatus> {
    throw new Error('Not implemented');
  }

  async cancelSync(): Promise<void> {
    throw new Error('Not implemented');
  }
}
