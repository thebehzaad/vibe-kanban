/**
 * Remote client service
 * Translates: crates/services/src/services/remote_client.rs
 *
 * Client for remote vibe-kanban instances.
 */

export interface RemoteClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
}

export class RemoteClientService {
  // TODO: Implement remote client
  constructor(private options: RemoteClientOptions) {}

  async connect(): Promise<void> {
    throw new Error('Not implemented');
  }

  async syncData(): Promise<void> {
    throw new Error('Not implemented');
  }

  async disconnect(): Promise<void> {
    throw new Error('Not implemented');
  }
}
